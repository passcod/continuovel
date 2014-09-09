(function() {
  var flip, flipper = function(night) {
    var html = document.documentElement;
    if (/flipped/.test(html.className) || !night) {
      html.className = html.className.replace('flipped', '');
      flip.innerHTML = 'day';
      localStorage.setItem('flip', '');
    } else {
      html.className += ' flipped';
      flip.innerHTML = 'night';
      localStorage.setItem('flip', '✓');
    }
  };

  $tart.push(function() {
    flip = document.querySelector('.flip');
    flip.addEventListener('click', flipper, null);
    flipper(localStorage.getItem('flip'));
    setTimeout(function() {
      document.documentElement.className += ' js';
    }, 1000);
  });
}());
