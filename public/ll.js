/*
 * LightLeads: скрипт для сайта клиента.
 * 1. Запоминает рекламные метки (UTM, fbclid, ttclid) в cookie на 30 дней.
 * 2. Подставляет их в скрытые поля всех форм.
 * 3. При отправке формы с телефоном передаёт лид в LightLeads.
 *
 * Подключение: <script src="https://…/ll.js" data-key="ws_…" async></script>
 * data-send="off" — не отправлять лиды самому (если их уже шлёт вебхук сайта).
 * Свою форму без события submit можно отправить вручную: LightLeads.send({ phone: "…", name: "…" }).
 */
(function () {
  var script = document.currentScript;
  if (!script || window.LightLeads) return;

  var KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "fbclid", "ttclid"];
  var DAYS = 30;
  var MIN_PHONE_DIGITS = 7;
  var key = script.getAttribute("data-key") || "";
  var autoSend = script.getAttribute("data-send") !== "off";
  var endpoint = new URL("/api/ingest/lead", script.src).href;

  var params = new URLSearchParams(location.search);
  KEYS.forEach(function (name) {
    var value = params.get(name);
    if (value) document.cookie = "ll_" + name + "=" + encodeURIComponent(value) + "; path=/; max-age=" + DAYS * 86400 + "; SameSite=Lax";
  });

  function read(name) {
    var match = document.cookie.match(new RegExp("(?:^|; )ll_" + name + "=([^;]*)"));
    return match ? decodeURIComponent(match[1]) : "";
  }

  function utm() {
    var result = {};
    KEYS.forEach(function (name) {
      var value = read(name);
      if (value) result[name] = value;
    });
    return result;
  }

  function fill(form) {
    KEYS.forEach(function (name) {
      var input = form.querySelector('input[name="' + name + '"]');
      if (!input) {
        input = document.createElement("input");
        input.type = "hidden";
        input.name = name;
        form.appendChild(input);
      }
      if (!input.value) input.value = read(name);
    });
  }

  function send(lead) {
    if (!key || !lead || !lead.phone) return;
    var payload = utm();
    payload.phone = String(lead.phone);
    if (lead.name) payload.name = String(lead.name);
    payload.page = location.origin + location.pathname;
    var body = JSON.stringify(payload);
    var url = endpoint + "?key=" + encodeURIComponent(key);
    // text/plain не требует предварительного запроса браузера и успевает уйти до перехода на другую страницу
    try {
      if (navigator.sendBeacon && navigator.sendBeacon(url, new Blob([body], { type: "text/plain" }))) return;
    } catch {}
    try {
      fetch(url, { method: "POST", body: body, keepalive: true, headers: { "content-type": "text/plain" } }).catch(function () {});
    } catch {}
  }

  function valueOf(form, selector, pattern) {
    var found = form.querySelector(selector);
    if (found && found.value) return found.value;
    var inputs = form.querySelectorAll("input");
    for (var i = 0; i < inputs.length; i++) {
      var input = inputs[i];
      if (input.type === "hidden" || !input.value) continue;
      if (pattern.test(input.name || "") || pattern.test(input.placeholder || "") || pattern.test(input.id || "")) return input.value;
    }
    return "";
  }

  document.addEventListener(
    "submit",
    function (event) {
      var form = event.target;
      if (!form || form.tagName !== "FORM") return;
      fill(form);
      if (!autoSend) return;
      var phone = valueOf(form, 'input[type="tel"]', /phone|телефон|^tel/i);
      if (phone.replace(/\D/g, "").length < MIN_PHONE_DIGITS) return;
      send({ phone: phone, name: valueOf(form, 'input[autocomplete="name"]', /name|имя|фио/i) });
    },
    true,
  );

  function fillAll() {
    var forms = document.querySelectorAll("form");
    for (var i = 0; i < forms.length; i++) fill(forms[i]);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fillAll);
  else fillAll();

  window.LightLeads = { send: send, utm: utm };
})();
