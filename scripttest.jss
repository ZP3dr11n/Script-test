function extractUrlParam(url, paramName) {
  try {
    return new URL(url).searchParams.get(paramName);
  } catch {
    return null;
  }
}

function extractByRegex(text, regex, errorMessage) {
  const match = text.match(regex);
  if (!match || !match[1]) throw new Error(errorMessage);
  return match[1];
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

class RequestManager {
  constructor(baseUrl = 'https://expansao.educacao.sp.gov.br', maxRetries = 3) {
    this.baseUrl = baseUrl;
    this.maxRetries = maxRetries;
  }

  async fetchWithRetry(url, options = {}, retries = this.maxRetries) {
    try {
      const response = await fetch(url, { credentials: 'include', ...options });
      if (!response.ok) throw new Error(`Erro: ${response.status}`);
      return response;
    } catch (error) {
      if (retries > 0 && error.message.includes('429')) {
        await sleep(Math.pow(2, this.maxRetries - retries) * 1000);
        return this.fetchWithRetry(url, options, retries - 1);
      }
      throw error;
    }
  }

  createUrl(path, params = {}) {
    const url = new URL(path, this.baseUrl);
    Object.entries(params).forEach(([k, v]) => url.searchParams.append(k, v));
    return url.toString();
  }
}

class ExamAutomator {
  constructor() {
    this.requestManager = new RequestManager();
  }

  async fetchExamPage(examUrl) {
    const response = await this.requestManager.fetchWithRetry(examUrl);
    const text = await response.text();
    return {
      contextId: extractUrlParam(examUrl, 'id') || extractByRegex(text, /contextInstanceId":(\d+)/, 'CMID não encontrado'),
      sessKey: extractByRegex(text, /sesskey":"([^"]+)/, 'Sesskey não encontrado')
    };
  }

  async startExamAttempt(contextId, sessKey) {
    const url = this.requestManager.createUrl('/mod/quiz/startattempt.php');
    const params = new URLSearchParams({ cmid: contextId, sesskey });

    const response = await this.requestManager.fetchWithRetry(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
      redirect: 'follow'
    });

    const attemptMatch = response.url.match(/attempt=(\d+)/);
    if (!attemptMatch?.[1]) throw new Error('ID da tentativa não encontrado');
    return { redirectUrl: response.url, attemptId: attemptMatch[1] };
  }

  async extractQuestionInfo(questionUrl) {
    const response = await this.requestManager.fetchWithRetry(questionUrl);
    const html = await response.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');

    const data = { questId: null, seqCheck: null, options: [], attempt: null, sesskey: null, formFields: {} };

    doc.querySelectorAll("input[type='hidden']").forEach(input => {
      const name = input.name, value = input.value;
      if (!name) return;

      if (name.includes(':sequencecheck')) {
        data.questId = name.split(':')[0];
        data.seqCheck = value;
      } else if (['attempt', 'sesskey'].includes(name)) {
        data[name] = value;
      } else {
        data.formFields[name] = value;
      }
    });

    doc.querySelectorAll("input[type='radio']").forEach(input => {
      const name = input.name, value = input.value;
      if (name?.includes('_answer') && value !== '-1') data.options.push({ name, value });
    });

    if (!data.questId || !data.attempt || !data.sesskey || data.options.length === 0) {
      throw new Error('Informações insuficientes na página da questão');
    }

    return data;
  }

  async submitAnswer(data, contextId) {
    const option = data.options[Math.floor(Math.random() * data.options.length)];
    const formData = new FormData();

    formData.append(`${data.questId}:1_:flagged`, '0');
    formData.append(`${data.questId}:1_:sequencecheck`, data.seqCheck);
    formData.append(option.name, option.value);
    formData.append('attempt', data.attempt);
    formData.append('sesskey', data.sesskey);

    Object.entries(data.formFields).forEach(([k, v]) => formData.append(k, v));

    const url = this.requestManager.createUrl(`/mod/quiz/processattempt.php?cmid=${contextId}`);
    const response = await this.requestManager.fetchWithRetry(url, { method: 'POST', body: formData, redirect: 'follow' });
    return { redirectUrl: response.url, attemptId: data.attempt, sesskey: data.sesskey };
  }

  async finishExamAttempt(attemptId, contextId, sesskey) {
    const summaryUrl = this.requestManager.createUrl('/mod/quiz/summary.php', { attempt: attemptId, cmid: contextId });
    await this.requestManager.fetchWithRetry(summaryUrl);

    const body = new URLSearchParams({
      attempt: attemptId,
      finishattempt: '1',
      timeup: '0',
      slots: '',
      cmid: contextId,
      sesskey
    });

    const url = this.requestManager.createUrl('/mod/quiz/processattempt.php');
    const response = await this.requestManager.fetchWithRetry(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      redirect: 'follow'
    });

    return response.url;
  }

  async completeExam(examUrl) {
    const { contextId, sessKey } = await this.fetchExamPage(examUrl);
    const { redirectUrl, attemptId } = await this.startExamAttempt(contextId, sessKey);
    const questionData = await this.extractQuestionInfo(redirectUrl);
    const { attemptId: finalAttemptId, sesskey } = await this.submitAnswer(questionData, contextId);
    return this.finishExamAttempt(finalAttemptId, contextId, sesskey);
  }
}

class PageCompletionService {
  constructor(baseUrl = 'https://expansao.educacao.sp.gov.br') {
    this.baseUrl = baseUrl;
  }

  async markPageAsCompleted(pageId) {
    const url = new URL(`/mod/resource/view.php?id=${pageId}`, this.baseUrl);
    try {
      await fetch(url.toString(), {
        credentials: 'include',
        method: 'GET',
        headers: {
          'User-Agent': navigator.userAgent,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        }
      });
    } catch (error) {
      console.error(`Erro ao marcar página ${pageId} como concluída:`, error);
    }
  }
}

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

      for (let i = 0; i < exams.length; i++) {
        const exam = exams[i];
        progressText.textContent = `Processando exame ${i + 1}/${exams.length}: \"${exam.name}\"`;
        try {
          await this.examAutomator.completeExam(exam.url);
        } catch (err) {
          console.error(`Erro ao processar exame: ${exam.name}`, err);
        }
        if (i < exams.length - 1) await sleep(3000);
      }

      alert("Atividades finalizadas! Caso sobre alguma, execute novamente.");
    } catch (error) {
      console.error("Erro geral no processamento de atividades:", error);
      alert("Ocorreu um erro durante o processamento.");
    } finally {
      document.body.removeChild(document.querySelector("div[style*='position: fixed']"));
      location.reload();
    }
  }
}

function initActivityProcessor() {
  if (window.location.hostname !== 'expansao.educacao.sp.gov.br') {
    alert('Este script só funciona no site da Expansão Educacional de SP');
    return;
  }
  new ActivityProcessorUI().processActivities();
}

initActivityProcessor();
