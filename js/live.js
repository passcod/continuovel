(function() {
  var addr = '/';
  if (typeof SOCKET_PORT !== 'undefined') {
    addr = 'http://' + location.hostname + ':' + SOCKET_PORT;
  }
  var socket = io(addr);
  var state = {}, updates = [], ready = false;
  marked.setOptions({smartypants: true});
  
  socket.on('info', function(data) {
    debug && console.log(data);
    state = data;
    state.time_left = moment.duration(data.time_left);
    $tart.push(function() {
      socket.emit('chapter', {n: state.chapter});
    });
  });

  socket.on('chapter', function(data) {
    debug && console.log(data);
    state.chapter = data;
    ready = true;
    updateTitle();
    updates.some(updateText);
  });

  socket.on('current', function(data) {
    debug && console.log(data);
    if (ready) {
      updateText(data);
    } else {
      updates.push(data);
    }
  });

  socket.on('timeLeft', function(data) {
    debug && console.log(data);
    state.interval = data.interval;
    state.time_left = moment.duration(data.time_left);
    updateTime();
  });

  var updateText = function(data) {
    var i;
    if (i = updates.indexOf(data) != -1) {
      delete updates[i];
    }

    if (data.chapter != state.chapter.n) {
      ready = false;
      updates.unshift(data);
      window.location.reload(); // Workaround, FIXME
      socket.emit('chapter', {n: data.chapter});
      return false;
    } else {
      var e = document.querySelector('[data-live] .contents');
      state.chapter.contents += data.letter;
      e.innerHTML = marked(state.chapter.contents);
      updateTime();
    }
  };

  var updateTime = function() {
    if (typeof this.runs === 'undefined') {
      this.runs = 1;
    } else {
      this.runs++;
      if (this.runs > 10) {
        this.runs = 1;
        socket.emit('timeLeft');
      }
    }

    state.time_left.subtract(state.interval, 'ms');
    var e = document.querySelector('.subtitle');
    e.setAttribute('title', 'Buffer runs for another ' +
      state.time_left.humanize().replace(/^a\s/, '') + ' (' +
      state.time_left.asSeconds() + ' seconds)');
    e.innerHTML = 'Updates every ' +
      moment.duration(state.interval).humanize().replace(/^a\s/, '');
  };

  var updateTitle = function() {
    document.querySelector('[data-live] > h1')
      .innerHTML = 'Chapter ' + state.chapter.n +
      ': ' + state.chapter.title;
    document.querySelector('[data-live]')
      .setAttribute('data-id', state.chapter.n);
  };
}());
