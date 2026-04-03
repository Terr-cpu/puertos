const APP_URL = "https://script.google.com/macros/s/AKfycbxWWRqBRJkgVenOCzNVa82BQRryCKtXXMzCqDQMBJzQnmfMpBYOfu7cBBZAnoPNgC4A/exec";

const form = document.getElementById("dispoForm");
const btn = document.getElementById("btnSubmit");
const feedback = document.getElementById("feedback");
const accordion = document.getElementById("accordionSemanas");

const dias = ["Martes","Jueves","Viernes","Sabado","Domingo"];

// Generar opciones de 8 a 21
function generarOpcionesHoras() {
  let options = '<option value="No disponible">No disponible</option>';
  for (let h = 8; h <= 21; h++) {
    let hora = h < 10 ? `0${h}:00` : `${h}:00`;
    options += `<option value="${hora}">${hora}</option>`;
  }
  return options;
}

function generarSemanas() {
  const horasHtml = generarOpcionesHoras();
  for (let s = 1; s <= 4; s++) {
    const item = document.createElement("div");
    item.className = "accordion-item";
    item.innerHTML = `
      <h2 class="accordion-header">
        <button class="accordion-button ${s!==1?'collapsed':''}" type="button" data-bs-toggle="collapse" data-bs-target="#semana${s}">
          Semana ${s}
        </button>
      </h2>
      <div id="semana${s}" class="accordion-collapse collapse ${s===1?'show':''}" data-bs-parent="#accordionSemanas">
        <div class="accordion-body">
          <div class="table-responsive">
            <table class="table table-sm align-middle">
              <thead>
                <tr>
                  <th>Día</th>
                  <th>Desde</th>
                  <th>Hasta</th>
                </tr>
              </thead>
              <tbody>
                ${dias.map(dia => `
                  <tr>
                    <td class="fw-bold">${dia}</td>
                    <td><select name="S${s}_${dia}_In" class="form-select form-select-sm">${horasHtml}</select></td>
                    <td><select name="S${s}_${dia}_Out" class="form-select form-select-sm">${horasHtml}</select></td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>`;
    accordion.appendChild(item);
  }
}

generarSemanas();

form.addEventListener("submit", (e) => {
  e.preventDefault();
  btn.disabled = true;
  btn.textContent = "Enviando...";
  feedback.className = "alert alert-info text-center";
  feedback.textContent = "Procesando...";
  feedback.classList.remove("d-none");

  const formData = new FormData(form);
  const params = new URLSearchParams();
  params.append("nombre", formData.get("nombre"));

  for (let s = 1; s <= 4; s++) {
    dias.forEach(dia => {
      params.append(`S${s}_${dia}_In`, formData.get(`S${s}_${dia}_In`));
      params.append(`S${s}_${dia}_Out`, formData.get(`S${s}_${dia}_Out`));
    });
  }

  fetch(APP_URL, {
    method: "POST",
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString()
  })
  .then(res => res.json())
  .then(data => {
    if (data.status === "success") {
      feedback.className = "alert alert-success text-center fw-bold";
      feedback.textContent = "✅ Disponibilidad guardada";
      form.reset();
    } else { throw new Error(data.message); }
  })
  .catch(err => {
    feedback.className = "alert alert-danger text-center";
    feedback.textContent = "❌ Error al enviar";
  })
  .finally(() => {
    btn.disabled = false;
    btn.textContent = "ENVIAR DISPONIBILIDAD";
  });
});
