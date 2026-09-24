import './phone-panels.js';
(async () => {
window.raceStartup('A carregar os gráficos originais da Astra…');
// Paint the independent startup screen before evaluating the large race module.
await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
try {
  await import('./main.js');
  window.raceStartup('Corrida iniciada.');
  document.getElementById('startup-screen').style.display = 'none';
} catch (error) {
  window.raceStartup(`Não foi possível iniciar: ${error.message}. Abre este endereço diretamente no Chrome.`, true);
}
})();
