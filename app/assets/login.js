// The app's own login page (index.html): the Iridiums in the app's list, one to add, and the
// key that logs in to the chosen one from the system's browser, where the passkey is (gui.go).
'use strict';

const $ = (id) => document.getElementById(id);
let servers = [];
let busy = false;

function status(msg, error = false) {
  $('status').textContent = msg;
  $('status').classList.toggle('error', error);
}

function ask(msg) {
  const w = window._wails;
  if (!w || typeof w.invoke !== 'function') return status('无法连接应用', true);
  w.invoke(msg);
}

function draw(state) {
  servers = state.servers || [];
  const sel = $('server');
  sel.replaceChildren(...servers.map((s) => Object.assign(document.createElement('option'), { value: s.url, textContent: s.host, selected: s.url === state.current })));
  $('pick').hidden = servers.length === 0;
  // None yet: the address is asked for in the select's place.
  if (servers.length === 0) showAdd();
  else if (!$('add').dataset.open) $('add').hidden = true;
}

function showAdd() {
  $('add').hidden = false;
  $('add').dataset.open = '1';
  $('addr').focus();
}

function hideAdd() {
  if (servers.length === 0) return;
  $('add').hidden = true;
  delete $('add').dataset.open;
  $('addr').value = '';
}

/** The address typed, if the field is open with one; else the server chosen. */
function target() {
  const typed = !$('add').hidden && $('addr').value.trim();
  return typed || $('server').value;
}

function login() {
  if (busy) return;
  const t = target();
  if (!t) {
    showAdd();
    return status('填写服务器地址', true);
  }
  busy = true;
  $('login').setAttribute('aria-busy', 'true');
  status('');
  ask('ir:login:' + t);
}

function done() {
  busy = false;
  $('login').removeAttribute('aria-busy');
}

window.addEventListener('ir-app', (e) => {
  const d = e.detail || {};
  if (d.servers) {
    draw(d);
    if (d.added) hideAdd();
  }
  if (d.code) status('在浏览器中核对代码 ' + d.code + ' 后允许');
  if (d.error) {
    done();
    status(d.error, true);
  }
});

function greet() {
  const w = window._wails;
  if (greet.done || !w || typeof w.invoke !== 'function') return;
  greet.done = true;
  w.invoke('wails:runtime:ready');
  w.invoke('ir:hello');
}

document.addEventListener('DOMContentLoaded', () => {
  $('login').onclick = login;
  $('plus').onclick = () => ($('add').hidden ? showAdd() : hideAdd());
  $('server').onchange = () => ask('ir:select:' + $('server').value);
  $('add').onsubmit = (e) => (e.preventDefault(), login());
  $('addr').onkeydown = (e) => e.key === 'Escape' && hideAdd();
  window.addEventListener('wails:runtime-config-ready', greet);
  greet();
});
