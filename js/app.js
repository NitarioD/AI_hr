/**
 * Client-side app: collects job title, calls our own /api/generate,
 * renders questions or errors. No API keys in the browser.
 */

(function () {
  "use strict";

  const form = document.getElementById("job-form");
  const input = document.getElementById("job-title");
  const submitBtn = document.getElementById("submit-btn");
  const loading = document.getElementById("loading");
  const errorBox = document.getElementById("error");
  const output = document.getElementById("output");
  const list = document.getElementById("question-list");

  function setLoading(isLoading) {
    submitBtn.disabled = isLoading;
    input.disabled = isLoading;
    loading.classList.toggle("is-visible", isLoading);
  }

  function showError(message) {
    errorBox.textContent = message;
    errorBox.classList.add("is-visible");
  }

  function clearError() {
    errorBox.textContent = "";
    errorBox.classList.remove("is-visible");
  }

  function renderQuestions(questions) {
    list.innerHTML = "";
    questions.forEach((q) => {
      const li = document.createElement("li");
      li.textContent = q;
      list.appendChild(li);
    });
    output.hidden = false;
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearError();
    output.hidden = true;

    const jobTitle = input.value.trim();
    if (!jobTitle) {
      showError("Please enter a job title.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobTitle }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        const detail = data.detail ? ` (${data.detail})` : "";
        showError((data.error || `Request failed (${res.status})`) + detail);
        return;
      }

      if (!Array.isArray(data.questions) || data.questions.length !== 3) {
        showError("Unexpected response from server.");
        return;
      }

      renderQuestions(data.questions);
    } catch (err) {
      console.error(err);
      showError("Network error. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  });
})();
