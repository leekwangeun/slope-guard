// ============================================================
// The start countdown of both simulations, in the manner of a racing game:
// three start lamps over a big outlined numeral. 3, 2, 1 light the lamps one by one
// in red (one per buzzer beep of the firmware); at the start they all turn green and
// "출발!" pops up, then fades. The numerals stay white; only the lamps carry colour.
// ============================================================
export function createCountdown(el) {
  el.classList.add('countdown');
  el.innerHTML = `
    <div class="lamps"><i></i><i></i><i></i></div>
    <svg class="num" viewBox="0 0 420 240" aria-hidden="true"><text x="210" y="196" text-anchor="middle"></text></svg>`;
  const lamps = [...el.querySelectorAll('.lamps i')], num = el.querySelector('.num'), text = el.querySelector('text');
  let step = null, timer = 0;

  // a new step: lamps, the numeral, and its pop restarted
  function set(s, label, lit) {
    if (s === step) return;
    step = s;
    clearTimeout(timer);
    el.dataset.step = s;
    text.textContent = label;
    lamps.forEach((l, i) => l.classList.toggle('on', i < lit));
    num.classList.remove('pop');
    void num.getBoundingClientRect();                 // so the animation starts again
    num.classList.add('pop');
    el.hidden = false;
  }
  const show = (n) => set(String(n), String(n), 4 - n);
  function go() {
    set('go', '출발!', 3);
    timer = setTimeout(hide, 900);
  }
  function hide() {
    clearTimeout(timer);
    step = null;
    el.hidden = true;
  }
  return { show, go, hide };
}
