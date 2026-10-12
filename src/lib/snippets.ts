/** Готовые строки URL-параметров для рекламных кабинетов. Макросы подставляет сама платформа. */
export const UTM_TEMPLATES = {
  meta: "utm_source=facebook&utm_medium=paid&utm_campaign={{campaign.id}}&utm_term={{adset.id}}&utm_content={{ad.id}}",
  tiktok: "utm_source=tiktok&utm_medium=paid&utm_campaign=__CAMPAIGN_ID__&utm_term=__AID__&utm_content=__CID__",
} as const;

export const INGEST_PATH = "/api/ingest/lead";
export const DEMO_WORKSPACE_KEY = "ws_demo_3f9a1c7e52b84d0a";

/** Сниппет для сайта: хранит UTM, fbclid, ttclid в cookie 30 дней и подставляет в скрытые поля форм. */
export const SITE_SNIPPET = `<script>
(function () {
  var KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "fbclid", "ttclid"];
  var DAYS = 30;
  var params = new URLSearchParams(location.search);
  KEYS.forEach(function (key) {
    var value = params.get(key);
    if (value) {
      document.cookie = "ll_" + key + "=" + encodeURIComponent(value) +
        "; path=/; max-age=" + DAYS * 86400 + "; SameSite=Lax";
    }
  });
  function read(key) {
    var m = document.cookie.match(new RegExp("(?:^|; )ll_" + key + "=([^;]*)"));
    return m ? decodeURIComponent(m[1]) : "";
  }
  document.addEventListener("DOMContentLoaded", function () {
    document.querySelectorAll("form").forEach(function (form) {
      KEYS.forEach(function (key) {
        var input = form.querySelector('input[name="' + key + '"]');
        if (!input) {
          input = document.createElement("input");
          input.type = "hidden";
          input.name = key;
          form.appendChild(input);
        }
        input.value = read(key);
      });
    });
  });
})();
</script>`;

export const ingestExample = (origin: string) => `curl -X POST ${origin}${INGEST_PATH} \\
  -H "x-workspace-key: ${DEMO_WORKSPACE_KEY}" \\
  -H "content-type: application/json" \\
  -d '{"phone": "8 701 123 45 67", "name": "Айгерим", "utm_source": "facebook", "utm_content": "120210000000000"}'`;
