// Scales the fixed 1080×1920 stage to fit the window.
export function fitStage(stage) {
  const fit = () => {
    const scale = Math.min(window.innerWidth / 1080, window.innerHeight / 1920);
    stage.style.transform = `translate(-50%, -50%) scale(${scale})`;
  };
  window.addEventListener('resize', fit);
  window.visualViewport?.addEventListener('resize', fit);
  fit();
}
