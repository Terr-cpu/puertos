const APP_URL = "https://script.google.com/macros/s/AKfycbxmoMhbbY6qN-rXdz5N8KFKZQLQbvaHIkUEZNPBFL4HBP0Jxn62SeRO058CqyENYQZE/exec";

const form = document.getElementById("dispoForm");
const btn = document.getElementById("btnSubmit");
const feedback = document.getElementById("feedback");
const accordion = document.getElementById("accordionSemanas");

const dias = ["Martes","Jueves","Viernes","Sabado","Domingo"];
const turnos = ["M","T"];

function generarSemanas() {
  for (let s = 1; s <= 4; s++) {

    const item = document.createElement("div");
    item.className = "accordion-item";

    item.innerHTML = `
      <h2 class="accordion-header">
        <button class="accordion-button ${s!==1?'collapsed':''}" type="button"
          data-bs-toggle="collapse"
          data-bs-target="#semana${s}">
          Semana ${s}
        </button>
      </h2>

      <div id="semana${s}" class="accordion-collapse collapse ${s===1?'show':''}"
        data-bs-parent="#accordionSemanas">

        <div class="accordion-body">
          ${generarTabla(s)}
        </div>
      </div>
    `;

    accordion.appendChild(item);
  }
}

function generarTabla(semana) {

  let html = `
  <div class="table-responsive">
  <table class="table table-bordered align-middle text-center">
  <thead class="table-light">
  <tr>
    <th>Día</th>
    <th>Mañana</th>
    <th>Tarde</th>
  </tr>
  </thead>
  <tbody>
  `;

  dias.forEach(dia => {
    html += `
      <tr>
        <td class="fw-semibold">${dia}</td>
        <td><input type="checkbox" name="S${semana}_${dia}_M"></td>
        <td>${dia==="Sabado"||dia==="Domingo"?"---":`<input type="checkbox" name="S${semana}_${dia}_T">`}</td>
      </tr>
    `;
  });

  html += "</tbody></table></div>";

  return html;
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

  for (let s=1; s<=4; s++){
    dias.forEach(dia=>{
      turnos.forEach(turno=>{
        if (dia==="Sabado"||dia==="Domingo"){
          if(turno==="T") return;
        }
        const campo = `S${s}_${dia}_${turno}`;
        const valor = formData.get(campo);
        params.append(campo, valor==="on"?"SI":"NO");
      });
    });
  }

  fetch(APP_URL,{
    method:"POST",
    headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:params.toString()
  })
  .then(res=>res.json())
  .then(data=>{
    if(data.status==="success"){
      feedback.className="alert alert-success text-center fw-bold";
      feedback.textContent="✅ Disponibilidad guardada";
      form.reset();
    }else{
      throw new Error(data.message);
    }
  })
  .catch(err=>{
    feedback.className="alert alert-danger text-center";
    feedback.textContent="❌ Error al enviar";
    console.error(err);
  })
  .finally(()=>{
    btn.disabled=false;
    btn.textContent="ENVIAR DISPONIBILIDAD";
  });

});
