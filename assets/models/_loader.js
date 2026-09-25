/* assets/models/_loader.js — синхронно подтягивает модели по манифесту.
 *
 * Зачем document.write. На file:// fetch/XHR к локальной папке блокируется
 * CORS (opaque origin), поэтому список файлов приходит из manifest.js, а
 * сами скрипты вставляются в поток парсинга через document.write. Пока
 * браузер ещё разбирает HTML, такой write гарантированно синхронный:
 * каждый <script> успевает выполниться до того, как парсер дойдёт до
 * <script type="module"> ниже по странице. Никаких async-ожиданий,
 * никаких «module ran before models loaded».
 *
 * Манифест: window.MeridianModels — массив имён файлов без пути, например
 *   window.MeridianModels = ['hero.js', 'pedestrian.js', …];
 * Сам manifest.js и этот загрузчик в список не входят.
 *
 * Список генерируется скриптом sync_models.sh из содержимого папки:
 *   ls assets/models/*.js → manifest.js
 */
(function () {
  'use strict';
  const files = window.MeridianModels;
  if (!files || !files.length) {
    // Ничего не подтягиваем — это не ошибка, просто пустой манифест.
    return;
  }
  for (let i = 0; i < files.length; i++) {
    // Экранирование не нужно: имена формируются sync_models.sh, только a-zA-Z0-9._-
    document.write('<script src="./models/' + files[i] + '"><\/script>');
  }
})();
