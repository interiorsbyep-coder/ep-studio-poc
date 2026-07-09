(function(){
  document.querySelectorAll('.app-tab[data-tab]').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.app-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const target = tab.dataset.tab;
      document.querySelectorAll('.app-panel').forEach(panel => {
        panel.classList.toggle('active', panel.dataset.panel === target);
      });
    });
  });
})();
