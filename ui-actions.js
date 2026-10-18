// External handlers keep the CSP free of unsafe-inline JavaScript.
document.addEventListener("click", event => {
  const button = event.target.closest("[data-close-modal], [data-reload]");
  if (!button) return;
  if (button.hasAttribute("data-reload")) location.reload();
  else document.getElementById(button.dataset.closeModal)?.classList.remove("active");
});
