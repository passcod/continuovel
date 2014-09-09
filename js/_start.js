var $tart = [];
var debug = false;
domready(function() {
  var selfexec = function(fn) { fn(); };
  $tart.push = selfexec;
  $tart.forEach(selfexec);
});
