class ActivityProcessorUI {
  constructor() {
    this.examAutomator = new ExamAutomator();
    this.pageCompletionService = new PageCompletionService();
  }

  createLoadingOverlay() {
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      background: rgba(0,0,0,0.8); display: flex; flex-direction: column;
      justify-content: center; align-items: center; z-index: 9999;
    `;

    overlay.innerHTML = `
      <style>
        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
      </style>
      <div style="border: 16px solid #f3f3f3; border-radius: 50%; border-top: 16px solid #3498db; width: 120px; height: 120px; animation: spin 2s linear infinite; margin-bottom: 20px;"></div>
      <div style="color: white; font-size: 24px; font-weight: bold;">Processando atividades...</div>
      <div id="progressText" style="color: white; font-size: 18px; margin-top: 10px;"></div>
    `;

    document.body.appendChild(overlay);
    return overlay.querySelector('#progressText');
  }

  async processActivities() {
    alert("Script feito por ZP3dr1n");
    const progressText = this.createLoadingOverlay();

    try {
      const activities = Array.from(document.querySelectorAll("li.activity"))
        .filter(act => {
          const link = act.querySelector("a.aalink");
          const btn = act.querySelector(".completion-dropdown button");
          return link && link.href && (!btn || !btn.classList.contains("btn-success"));
        });

      const pages = [], exams = [];
      for (const act of activities) {
        const link = act.querySelector("a.aalink");
        const url = new URL(link.href);
        const id = url.searchParams.get("id");
        const name = link.textContent.trim();

        if (id) (/responda|pause|quiz/i.test(name) ? exams : pages).push({ id, url: link.href, name });
      }

      progressText.textContent = `Marcando ${pages.length} páginas como concluídas...`;
      await Promise.all(pages.map(p => this.pageCompletionService.markPageAsCompleted(p.id)));

      // Processar os exames em paralelo
      const examPromises = exams.map((exam, index) => {
        return new Promise(async (resolve, reject) => {
          progressText.textContent = `Processando exame ${index + 1}/${exams.length}: \"${exam.name}\"`;
          try {
            await this.examAutomator.completeExam(exam.url);
            resolve();
          } catch (err) {
            console.error(`Erro ao processar exame: ${exam.name}`, err);
            reject(err);
          }
        });
      });

      // Espera todos os exames serem processados em paralelo
      await Promise.all(examPromises);

      alert("Atividades finalizadas! Caso sobre alguma, execute novamente.");
    } catch (error) {
      console.error("Erro geral no processamento de atividades:", error);
      alert("Ocorreu um erro durante o processamento.");
    } finally {
      document.body.removeChild(document.querySelector("div[style*='position: fixed']"));
    }
  }

  createButton() {
    const button = document.createElement('button');
    button.textContent = "Iniciar Processamento de Atividades";
    button.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      padding: 10px 20px;
      background-color: #3498db;
      color: white;
      border: none;
      border-radius: 5px;
      cursor: pointer;
      font-size: 16px;
    `;
    button.onclick = () => this.processActivities();
    document.body.appendChild(button);
  }
}

function initActivityProcessor() {
  if (window.location.hostname !== 'expansao.educacao.sp.gov.br') {
    alert('Este script só funciona no site da Expansão Educacional de SP');
    return;
  }

  const processorUI = new ActivityProcessorUI();
  processorUI.createButton();  // Adiciona o botão à página
}

initActivityProcessor();
