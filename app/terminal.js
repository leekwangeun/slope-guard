// ============================================================
// A Bluetooth serial terminal like the phone app used with the real car:
// time-stamped lines, macro buttons M1 to M3 and a command line.
// The simulation feeds it the same CSV lines the firmware prints, and
// gets the commands back (s = start, x = stop, c = calibrate).
// ============================================================
const $ = (id) => document.getElementById(id);
const MAX_LINES = 600;

const stamp = () => {
  const d = new Date(), p = (n, k = 2) => String(n).padStart(k, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
};

export function createTerminal({ onCommand }) {
  const log = $('term-log');
  let pending = document.createDocumentFragment(), count = 0;

  // kind: 'data' (from the car, green), 'sys' (the app itself, grey), 'echo' (what was sent, blue)
  function print(text, kind = 'data') {
    const line = document.createElement('div');
    line.className = `ln ${kind}`;
    line.append(Object.assign(document.createElement('span'), { className: 'ts', textContent: stamp() }), document.createTextNode(text));
    pending.append(line);
  }
  // lines are added once per frame, so a burst of 20 ms lines lands together like a Bluetooth packet
  function flush() {
    if (!pending.childNodes.length) return;
    const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
    count += pending.childNodes.length;
    log.append(pending);
    pending = document.createDocumentFragment();
    while (count > MAX_LINES) { log.firstChild.remove(); count--; }
    if (atBottom) log.scrollTop = log.scrollHeight;
  }
  function clear() { log.textContent = ''; count = 0; }

  function send(cmd) {
    cmd = cmd.trim();
    if (!cmd) return;
    print(cmd, 'echo');
    onCommand(cmd.toLowerCase());
  }
  document.querySelectorAll('#term [data-cmd]').forEach((b) => { b.onclick = () => send(b.dataset.cmd); });
  $('term-form').addEventListener('submit', (e) => {
    e.preventDefault();
    send($('term-in').value);
    $('term-in').value = '';
  });
  $('term-clear').onclick = clear;

  // the i button: a guide to reading the log, over the log until it is closed
  const help = $('term-help'), info = $('term-info');
  const showHelp = (on) => { help.hidden = !on; info.setAttribute('aria-expanded', on); if (on) help.scrollTop = 0; };
  info.onclick = () => showHelp(help.hidden);
  $('term-help-close').onclick = () => showHelp(false);

  // the fold button: the terminal shrinks to its title bar and opens again where the log has got to
  const box = $('term'), fold = $('term-fold');
  fold.onclick = () => {
    const folded = box.classList.toggle('folded');
    document.body.classList.toggle('term-folded', folded);
    fold.setAttribute('aria-expanded', !folded);
    fold.title = folded ? '터미널 펼치기' : '터미널 접기';
    fold.setAttribute('aria-label', fold.title);
    if (folded) showHelp(false);
    else log.scrollTop = log.scrollHeight;
  };

  return { print, flush, clear, send };
}
