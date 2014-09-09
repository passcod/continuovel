// This is horrible, horrible code.
// On a design level.
// Fix whenever.

var async = require('async');
var engines = require('consolidate');
var express = require('express');
var fs = require('fs');
var marked = require('marked');
var moment = require('moment');
var morgan = require('morgan');
var path = require('path');
var socketio = require('socket.io'); 
var util = require('util');

marked.setOptions({smartypants: true});

var inspect = function(o) { console.log(util.inspect(o)); };

var novel_dir = './source';
var chapter_rgx = /^\d{2,}-(.+)\.md$/i;
var $ = { // Oh look, a GLOBAL. @#$%!#$%@!#$%@!
  app: express(),
  chapter: 0,
  current: null,
  // Start at 3-5 minutes, decrease as buffer++
  interval: moment.duration(3, 'minutes'),
  io: {},
  pointer: -1,
  texts: ['']
};

// Yeah, sure, that will be just dandy, just gotta
// remember: chapters 'in the past' when looking at
// the pointer are fine to edit, chapters 'in the future'
// are fine to edit, the text of the chapter currently
// pointed 'in the future' is fine to edit, but be careful
// near the horizon, and the test of the chapter currently
// pointed 'in the past' is COMPLETELY FROZEN. So maybe,
// to be careful, consider the ENTIRE CHAPTER is FROZEN.
// And remember TIME DOESN'T STOP. Nor does the pointer.

var getId = function() {
  if (isNaN($.pointer)) {
    $.pointer = 0;
    console.log('Pointer was NaN, something is wrong!');
    return process.exit();
  }
  return [$.chapter, $.pointer].join(':');
};
var savePointer = function() {
  fs.writeFile('pointer', getId());
};
var loadPointer = function(str) {
  var parts = str.split(':');
  $.chapter = +parts[0];
  $.pointer = +parts[1];
};
var updatePos = function() {
  $.pointer += 1;
  var ch = $.texts[$.chapter];
  if ($.pointer >= ch.contents.length) {
    $.chapter += 1;
    $.pointer = 0;
    console.log('Switched to chapter %d', $.chapter);
  }
  savePointer();
  $.current = ch.contents[$.pointer];
  console.log('Current: ch=%d pos=%d chr=%s',
    $.chapter, $.pointer, util.inspect($.current));
};
var getChapter = function(n) {
  n = parseInt(n) || 0;
  var ch = $.texts[n].contents;
  var re = {n: n, title: $.texts[n].title};

  if (n == $.chapter) {
    re.contents = ch.substring(0, $.pointer);
  } else if (n > $.chapter) {
    re.title = '';
    re.contents = '';
  } else {
    re.contents = ch;
  }

  re.title = re.title.replace('-', ' ');
  re.title = re.title[0].toUpperCase() + re.title.substring(1);
  return re;
};
var emitCurrent = function(socket) {
  socket.emit('current', {
    chapter: $.chapter,
    pointer: $.pointer,
    letter:  $.current
  });
};
var timeLeft = function() {
  var chrs_to_go = $.texts.slice($.chapter).reduce(function(p, t, i) {
    if (i == 0) {
      return p + t.contents.slice($.pointer).length;
    } else {
      return p + t.contents.length;
    }
  }, 0);
  return moment.duration(chrs_to_go * $.interval.asMilliseconds(), 'ms');
};

var reloadChapters = function(callback) {
  async.waterfall([
    function(cb) {
      fs.readdir(novel_dir, cb);
    },
    function(files, cb) {
      async.map(files, function(file, c) {
        fs.readFile(path.join(novel_dir, file), function(err, data) {
          c(null, [file, (data || new Buffer(0)).toString()]);
        });
      }, cb);
    },
    function(files, cb) {
      $.texts = files.filter(function(item) {
        return chapter_rgx.test(item[0]);
      }).sort(function(a, b) {
        return ((a[0] > b[0]) ^ 0) * 2 - 1;
      }).map(function(file) {
        return {
          title: chapter_rgx.exec(file[0])[1],
          filename: file[0],
          contents: file[1]
        };
      });
      
      cb(null);
    }
  ], function(err) {
    callback(err);
  });
};

async.waterfall([
  reloadChapters,
  function(cb) {
    fs.readFile('pointer', function(err, data) {
      !err && loadPointer(data.toString());
      cb(err);
    });
  },
  function(cb) {
    updatePos();
    cb(null);
  },
  function(cb) {
    var port = process.env['PORT'] || 3000;
    var server = $.app.listen(port, function() {
      cb(null, server);
    });
  },
  function(server, cb) {
    $.io = socketio(server);
    console.log('Listening on port %d', server.address().port);
    cb(null);
  },
  function(cb) {
    setInterval(function() {
      updatePos();
      emitCurrent($.io);
    }, $.interval.asMilliseconds());
    cb(null);
  },
  function(cb) {
    $.io.on('connection', function (socket) {
      socket.emit('info', {
        chapter: $.chapter,
        interval: $.interval.asMilliseconds(),
        time_left: timeLeft().asMilliseconds()
      });
      emitCurrent(socket);

      socket.on('chapter', function (data) {
        socket.emit('chapter', getChapter(data.n));
      });

      socket.on('timeLeft', function () {
        socket.emit('timeLeft', {
          interval: $.interval.asMilliseconds(),
          time_left: timeLeft().asMilliseconds()
        });
      });
    });

    cb(null);
  }
], function(err) {
  if (err) {
    throw inspect(err);
  }
});

$.app.engine('jade', engines.jade);
$.app.use(morgan('combined'));

var ropts = {
  $: $,
  timeLeft: timeLeft,
  getChapter: getChapter,
  markdown: marked,
  moment: moment
};

$.app.get('/', function(req, res) {
  ropts.req = req;
  res.render('index.jade', ropts, function(err, html) {
    !err && res.send(html) || req.next(err);
  });
});

$.app.get('/feed', function(req, res) {
  ropts.req = req;
  res.render('feed.jade', ropts, function(err, html) {
    !err && res.send(html) || req.next(err);
  });
});

$.app.get('/chapter/:n', function(req, res) {
  ropts.req = req;
  if (req.params.n > $.chapter) {
    return req.next('not published yet');
  }

  res.render('chapter.jade', ropts, function(err, html) {
    !err && res.send(html) || req.next(err);
  });
});

function concatThings(what, where, callback) {
  async.map(what.split(',').map(function(s) {
    return path.join(where, [s, where].join('.'));
  }), fs.readFile, function(err, files) {
    if (err) {
      callback(err, null);
    } else {
      callback(null, files.map(function(file) {
        return file.toString();
      }).join('\n'));
    }
  });
}

$.app.get('/css/:styles', function(req, res) {
  concatThings(req.params.styles, 'css', function(err, str) {
    if (err) {
      req.next(err);
    } else {
      res.contentType('text/css');
      res.send(str);
    }
  });
});

$.app.get('/js/:scripts', function(req, res) {
  concatThings('_start,' + req.params.scripts, 'js', function(err, str) {
    if (err) {
      req.next(err);
    } else {
      res.contentType('application/javascript');
      res.send(str);
    }
  });
});
