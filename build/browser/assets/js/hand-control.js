document.addEventListener('DOMContentLoaded', () => {
  // Cuando se cargue la página, buscamos el botón del overlay
  const tutorialOverlay = document.getElementById('tutorialOverlay');
  const goBtn = document.getElementById('goToPortfolioBtn');

  // Al pulsar el botón, ocultamos el overlay y llamamos a setup()
  goBtn.addEventListener('click', () => {
    tutorialOverlay.style.display = 'none'; // Oculta overlay
    setup(); // Iniciar handpose, tracking, etc.
  });
});

let video, model;
let fingerCursor;

// Variables de suavizado
let smoothX = 0;
let smoothY = 0;
let firstRun = true;
const SMOOTHING_ALPHA = 0.4;

// Velocidad de scroll
const SCROLL_SPEED = 9;

// Detección de interacción (hover / click)
let lastHoveredElement = null;
let hoverStartTime = null;
const HOVER_CLICK_DELAY = 1500; // 1.5 s para click

// Training
let lastTrainingElement = null;
let hoverTimer = null;

// Lógica de tolerancia y revertir hover
const EXIT_TOLERANCE_TIME = 200;
const AREA_TOLERANCE_PX = 20;
let leaveTimer = null;
let revertTimer = null;
let previousHoveredElement = null;

// Canvas pequeño para la mano virtual
let handCursorCanvas, handCursorCtx;

document.addEventListener('DOMContentLoaded', () => {
  setup();
});

async function setup() {
  // 1. Referencia al puntero rojo
  fingerCursor = document.getElementById('fingerCursor');
  if (fingerCursor) {
    fingerCursor.style.pointerEvents = 'none';
  }

  // 2. Creamos el canvas para la mano virtual (60×60)
  handCursorCanvas = document.createElement('canvas');
  handCursorCanvas.id = 'handCursor';
  handCursorCanvas.width = 60;
  handCursorCanvas.height = 60;
  handCursorCanvas.style.position = 'fixed';
  handCursorCanvas.style.pointerEvents = 'none';
  handCursorCanvas.style.zIndex = '9998';
  // Por defecto, lo situamos en la esquina
  handCursorCanvas.style.left = '0px';
  handCursorCanvas.style.top  = '0px';
  document.body.appendChild(handCursorCanvas);

  handCursorCtx = handCursorCanvas.getContext('2d');

  // 3. Crear un video pequeño para debug
  video = document.createElement('video');
  video.width = 160;
  video.height = 120;
  video.style.position = 'fixed';
  video.style.left = '10px';
  video.style.bottom = '10px';
  video.style.border = '1px solid #ccc';
  video.style.backgroundColor = '#000';
  video.style.zIndex = '9999';
  document.body.appendChild(video);

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    video.srcObject = stream;
    await video.play();

    model = await handpose.load();
    console.log('✅ HandPose Model Loaded');

    requestAnimationFrame(detectHands);
  } catch (error) {
    console.error('❌ Error al acceder a la cámara:', error);
  }
}

/* ───────────────────────────────────────────────────────────────────────────
   1. Detectar si la mano está completamente abierta
   ─────────────────────────────────────────────────────────────────────────── */
function isHandOpen(landmarks) {
  const thumbTip = landmarks[4];
  const thumbBase = landmarks[2];
  const indexTip = landmarks[8];
  const indexBase = landmarks[5];
  const middleTip = landmarks[12];
  const middleBase = landmarks[9];
  const ringTip = landmarks[16];
  const ringBase = landmarks[13];
  const pinkyTip = landmarks[20];
  const pinkyBase = landmarks[17];

  return (
    thumbTip[1] < thumbBase[1] &&
    indexTip[1] < indexBase[1] &&
    middleTip[1] < middleBase[1] &&
    ringTip[1] < ringBase[1] &&
    pinkyTip[1] < pinkyBase[1]
  );
}

/* ───────────────────────────────────────────────────────────────────────────
   2. Bucle principal de detección de manos
   ─────────────────────────────────────────────────────────────────────────── */
async function detectHands() {
  if (!model || !video) {
    requestAnimationFrame(detectHands);
    return;
  }

  // Limpia el canvas cada frame
  handCursorCtx.clearRect(0, 0, handCursorCanvas.width, handCursorCanvas.height);

  const predictions = await model.estimateHands(video);
  if (predictions.length > 0) {
    // Suponemos una mano (predictions[0]); si hay dos, recorre predictions
    const landmarks = predictions[0].landmarks;

    // (A) Lógica de puntero con el dedo corazón (landmarks[12])
    const rawX = landmarks[12][0];
    const rawY = landmarks[12][1];

    if (firstRun) {
      smoothX = rawX;
      smoothY = rawY;
      firstRun = false;
    } else {
      smoothX += SMOOTHING_ALPHA * (rawX - smoothX);
      smoothY += SMOOTHING_ALPHA * (rawY - smoothY);
    }

    // Espejo en X para el puntero
    const mirroredX = 640 - smoothX;
    moveFingerCursor(mirroredX, smoothY);
    simulateElementMouseMove(mirroredX, smoothY);

    // (B) Posicionar el canvas en la posición del puntero
    const scaleX = window.innerWidth / 640;
    const scaleY = window.innerHeight / 480;
    const px = mirroredX * scaleX;
    const py = smoothY * scaleY;

    // Centrar el canvas 60×60 en (px,py)
    handCursorCanvas.style.left = (px - 30) + 'px';
    handCursorCanvas.style.top  = (py - 30) + 'px';

    // (C) Dibujamos la mano en miniatura, invertida
    drawMiniHandInverted(landmarks, handCursorCtx, 60, 60);

    // (D) Lógica de hover, click, scroll...
    const targetElement = detectInteractiveElement(mirroredX, smoothY);
    if (targetElement) {
      applyHoverEffect(targetElement, px, py);

      // Sólo si la mano está completamente abierta se dibuja el círculo verde
      if (isHandOpen(landmarks)) {
        if (!hoverStartTime) {
          hoverStartTime = Date.now();
        } else {
          let elapsed = Date.now() - hoverStartTime;
          let progress = Math.min(elapsed / HOVER_CLICK_DELAY, 1);

          // Dibujar el círculo de progreso en el canvas
          handCursorCtx.beginPath();
          // Se dibuja empezando a -90° y avanzando según el progreso
          handCursorCtx.arc(30, 30, 28, -Math.PI / 2, (-Math.PI / 2) + (2 * Math.PI * progress));
          handCursorCtx.strokeStyle = '#00FF00';
          handCursorCtx.lineWidth = 4;
          handCursorCtx.stroke();

          // Cuando el progreso llega a 1 se dispara el click
          if (progress === 1) {
            targetElement.click();
            console.log("🖱 Click en:", targetElement.innerText || "Elemento");
            hoverStartTime = null;
          }
        }
      } else {
        // Si la mano no está abierta, reiniciamos el temporizador (no se dibuja el círculo)
        hoverStartTime = null;
      }
    } else {
      if (lastHoveredElement) {
        lastHoveredElement.classList.remove("hand-hover");
        lastHoveredElement = null;
      }
      if (lastTrainingElement) {
        lastTrainingElement.classList.remove("hand-hover");
        clearTimeout(hoverTimer);
        lastTrainingElement = null;
      }
      hoverStartTime = null;
    }

    // Scroll según la dirección del dedo índice
    if (isIndexPointingDown(landmarks)) {
      window.scrollBy(0, SCROLL_SPEED);
    } else if (isIndexPointingUp(landmarks)) {
      window.scrollBy(0, -SCROLL_SPEED);
    }
  } else {
    // Sin detección: reiniciamos hover y eliminamos efectos
    if (lastHoveredElement) {
      lastHoveredElement.classList.remove("hand-hover");
      lastHoveredElement = null;
    }
    if (lastTrainingElement) {
      lastTrainingElement.classList.remove("hand-hover");
      clearTimeout(hoverTimer);
      lastTrainingElement = null;
    }
    hoverStartTime = null;
  }

  requestAnimationFrame(detectHands);
}

/**
 * Dibuja la mano invertida en miniatura (60x60) con líneas y puntos
 */
function drawMiniHandInverted(landmarks, ctx, canvasW, canvasH) {
  // 1. Crear un array con la mano invertida: x => 640 - x
  let mirroredLandmarks = landmarks.map(([x, y]) => [640 - x, y]);

  // 2. Calcular el bounding box
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < mirroredLandmarks.length; i++) {
    const [mx, my] = mirroredLandmarks[i];
    if (mx < minX) minX = mx;
    if (mx > maxX) maxX = mx;
    if (my < minY) minY = my;
    if (my > maxY) maxY = my;
  }
  const boxWidth  = maxX - minX;
  const boxHeight = maxY - minY;

  // 3. Queremos que la mano ocupe ~80% del canvas
  const targetSize = 0.8;
  const targetW = canvasW * targetSize;
  const targetH = canvasH * targetSize;

  // Escala: la menor de las dos para que quepa en 60x60
  const scale = Math.min(targetW / boxWidth, targetH / boxHeight);

  // 4. Centro del bounding box
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;

  // 5. Centro del canvas
  const cX = canvasW / 2;
  const cY = canvasH / 2;

  // 6. Transformar cada punto a coordenadas finales (desplazado + escalado)
  let finalPoints = [];
  for (let i = 0; i < mirroredLandmarks.length; i++) {
    let [mx, my] = mirroredLandmarks[i];
    mx = (mx - centerX) * scale + cX;
    my = (my - centerY) * scale + cY;
    finalPoints.push([mx, my]);
  }

  // 7. Dibujar líneas de los dedos (cada array representa la cadena de índices de un dedo)
  let fingers = [
    [0, 1, 2, 3, 4],     // pulgar
    [0, 5, 6, 7, 8],     // índice
    [0, 9, 10, 11, 12],  // medio
    [0, 13, 14, 15, 16], // anular
    [0, 17, 18, 19, 20]  // meñique
  ];

  ctx.strokeStyle = '#242b34';
  ctx.lineWidth = 2;

  for (let finger of fingers) {
    ctx.beginPath();
    for (let i = 0; i < finger.length; i++) {
      const idx = finger[i];
      const [fx, fy] = finalPoints[idx];
      if (i === 0) {
        ctx.moveTo(fx, fy);
      } else {
        ctx.lineTo(fx, fy);
      }
    }
    ctx.stroke();
  }

  // 8. Dibujar puntos en cada landmark
  ctx.beginPath();
  for (let [fx, fy] of finalPoints) {
    ctx.moveTo(fx, fy);
    ctx.arc(fx, fy, 3, 0, 2 * Math.PI);
  }
  ctx.fillStyle = '#ff9800';
  ctx.fill();
}

/* ───────────────────────────────────────────────────────────────────────────
   3. Detectar elemento interactivo bajo el cursor
   ─────────────────────────────────────────────────────────────────────────── */
function detectInteractiveElement(x, y) {
  const scaleX = window.innerWidth / 640;
  const scaleY = window.innerHeight / 480;
  const clientX = x * scaleX;
  const clientY = y * scaleY;
  return document.elementFromPoint(clientX, clientY);
}

/* ───────────────────────────────────────────────────────────────────────────
   4. Aplicar el efecto de hover
   ─────────────────────────────────────────────────────────────────────────── */
function applyHoverEffect(element, clientX, clientY) {
  const trainingBox = findClosestParent(element, "training-flip-box");
  if (trainingBox) { handleTrainingHover(trainingBox, clientX, clientY); return; }

  const portfolioBox = findClosestParent(element, "item-box");
  if (portfolioBox) { handlePortfolioHover(portfolioBox, clientX, clientY); return; }

  const achBox = findClosestParent(element, "box");
  if (achBox) {
    const containerAch = findClosestParent(achBox, "container-ach");
    if (containerAch) {
      handleAchievementHover(achBox, clientX, clientY);
      return;
    }
  }
  handleDefaultHover(element);
}

/* ───────────────────────────────────────────────────────────────────────────
   4.1 Lógica para Training
   ─────────────────────────────────────────────────────────────────────────── */
function handleTrainingHover(flipBox, clientX, clientY) {
  const interactiveChild = flipBox.querySelector(".training-front-flip") || flipBox;
  const rect = interactiveChild.getBoundingClientRect();
  const extendedRect = {
    left: rect.left - AREA_TOLERANCE_PX,
    right: rect.right + AREA_TOLERANCE_PX,
    top: rect.top - AREA_TOLERANCE_PX,
    bottom: rect.bottom + AREA_TOLERANCE_PX
  };
  const pointerInside =
    clientX >= extendedRect.left &&
    clientX <= extendedRect.right &&
    clientY >= extendedRect.top &&
    clientY <= extendedRect.bottom;

  if (pointerInside) {
    if (leaveTimer) {
      clearTimeout(leaveTimer);
      leaveTimer = null;
    }
    if (lastHoveredElement === flipBox && flipBox.classList.contains("hand-hover")) {
      return;
    }
    if (lastHoveredElement && lastHoveredElement !== flipBox) {
      previousHoveredElement = lastHoveredElement;
      lastHoveredElement.classList.remove("hand-hover");
    }
    flipBox.classList.add("hand-hover");
    lastHoveredElement = flipBox;

    if (revertTimer) clearTimeout(revertTimer);
    revertTimer = setTimeout(() => {
      flipBox.classList.remove("hand-hover");
      if (previousHoveredElement) {
        previousHoveredElement.classList.add("hand-hover");
        lastHoveredElement = previousHoveredElement;
        previousHoveredElement = null;
      }
    }, 8000);

    if (lastTrainingElement !== flipBox) {
      clearTimeout(hoverTimer);
      lastTrainingElement = flipBox;
      hoverTimer = setTimeout(() => {
        console.log("✨ Flip forzado en Training:", flipBox);
        const rectParent = flipBox.getBoundingClientRect();
        const simulatedX = rectParent.left + rectParent.width / 2;
        const simulatedY = rectParent.top + rectParent.height / 2;
        const clickEvent = new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          clientX: simulatedX,
          clientY: simulatedY,
          view: window
        });
        flipBox.dispatchEvent(clickEvent);
        console.log("🖱 Click forzado en:", flipBox);
      }, 3000);
    }
  } else {
    if (lastHoveredElement === flipBox) {
      if (!leaveTimer) {
        leaveTimer = setTimeout(() => {
          if (lastHoveredElement === flipBox) {
            flipBox.classList.remove("hand-hover");
            clearTimeout(revertTimer);
            revertTimer = null;
            lastHoveredElement = previousHoveredElement;
            previousHoveredElement = null;
          }
        }, EXIT_TOLERANCE_TIME);
      }
    }
  }
}

/* ───────────────────────────────────────────────────────────────────────────
   4.2 Lógica para Portfolio (item-box)
   ─────────────────────────────────────────────────────────────────────────── */
function handlePortfolioHover(itemBox, clientX, clientY) {
  const rect = itemBox.getBoundingClientRect();
  const extendedRect = {
    left: rect.left - AREA_TOLERANCE_PX,
    right: rect.right + AREA_TOLERANCE_PX,
    top: rect.top - AREA_TOLERANCE_PX,
    bottom: rect.bottom + AREA_TOLERANCE_PX
  };
  const pointerInside =
    clientX >= extendedRect.left &&
    clientX <= extendedRect.right &&
    clientY >= extendedRect.top &&
    clientY <= extendedRect.bottom;

  if (pointerInside) {
    if (leaveTimer) {
      clearTimeout(leaveTimer);
      leaveTimer = null;
    }
    if (lastHoveredElement === itemBox && itemBox.classList.contains("hand-hover")) {
      return;
    }
    if (lastHoveredElement && lastHoveredElement !== itemBox) {
      previousHoveredElement = lastHoveredElement;
      lastHoveredElement.classList.remove("hand-hover");
    }
    itemBox.classList.add("hand-hover");
    lastHoveredElement = itemBox;

    if (revertTimer) clearTimeout(revertTimer);
    revertTimer = setTimeout(() => {
      itemBox.classList.remove("hand-hover");
      if (previousHoveredElement) {
        previousHoveredElement.classList.add("hand-hover");
        lastHoveredElement = previousHoveredElement;
        previousHoveredElement = null;
      }
    }, 8000);
  } else {
    if (lastHoveredElement === itemBox) {
      if (!leaveTimer) {
        leaveTimer = setTimeout(() => {
          if (lastHoveredElement === itemBox) {
            itemBox.classList.remove("hand-hover");
            clearTimeout(revertTimer);
            revertTimer = null;
            lastHoveredElement = previousHoveredElement;
            previousHoveredElement = null;
          }
        }, EXIT_TOLERANCE_TIME);
      }
    }
  }
}

/* ───────────────────────────────────────────────────────────────────────────
   4.3 Lógica para Achievements (.box dentro de .container-ach)
   ─────────────────────────────────────────────────────────────────────────── */
function handleAchievementHover(achBox, clientX, clientY) {
  const rect = achBox.getBoundingClientRect();
  const extendedRect = {
    left: rect.left - AREA_TOLERANCE_PX,
    right: rect.right + AREA_TOLERANCE_PX,
    top: rect.top - AREA_TOLERANCE_PX,
    bottom: rect.bottom + AREA_TOLERANCE_PX
  };
  const pointerInside =
    clientX >= extendedRect.left &&
    clientX <= extendedRect.right &&
    clientY >= extendedRect.top &&
    clientY <= extendedRect.bottom;

  if (pointerInside) {
    if (leaveTimer) {
      clearTimeout(leaveTimer);
      leaveTimer = null;
    }
    if (lastHoveredElement === achBox && achBox.classList.contains("hand-hover")) {
      return;
    }
    if (lastHoveredElement && lastHoveredElement !== achBox) {
      previousHoveredElement = lastHoveredElement;
      lastHoveredElement.classList.remove("hand-hover");
    }
    achBox.classList.add("hand-hover");
    lastHoveredElement = achBox;

    if (revertTimer) clearTimeout(revertTimer);
    revertTimer = setTimeout(() => {
      achBox.classList.remove("hand-hover");
      if (previousHoveredElement) {
        previousHoveredElement.classList.add("hand-hover");
        lastHoveredElement = previousHoveredElement;
        previousHoveredElement = null;
      }
    }, 8000);
  } else {
    if (lastHoveredElement === achBox) {
      if (!leaveTimer) {
        leaveTimer = setTimeout(() => {
          if (lastHoveredElement === achBox) {
            achBox.classList.remove("hand-hover");
            clearTimeout(revertTimer);
            revertTimer = null;
            lastHoveredElement = previousHoveredElement;
            previousHoveredElement = null;
          }
        }, EXIT_TOLERANCE_TIME);
      }
    }
  }
}

/* ───────────────────────────────────────────────────────────────────────────
   4.4 Lógica por defecto (Social, Contact, etc.)
   ─────────────────────────────────────────────────────────────────────────── */
function handleDefaultHover(element) {
  if (leaveTimer) {
    clearTimeout(leaveTimer);
    leaveTimer = null;
  }
  if (lastHoveredElement === element && element.classList.contains("hand-hover")) {
    return;
  }
  if (lastHoveredElement && lastHoveredElement !== element) {
    previousHoveredElement = lastHoveredElement;
    lastHoveredElement.classList.remove("hand-hover");
  }
  element.classList.add("hand-hover");
  lastHoveredElement = element;
  if (revertTimer) clearTimeout(revertTimer);
  revertTimer = setTimeout(() => {
    element.classList.remove("hand-hover");
    if (previousHoveredElement) {
      previousHoveredElement.classList.add("hand-hover");
      lastHoveredElement = previousHoveredElement;
      previousHoveredElement = null;
    }
  }, 8000);
  clearTimeout(hoverTimer);
  lastTrainingElement = null;
}

/* ───────────────────────────────────────────────────────────────────────────
   5. findClosestParent: Busca un padre con la clase especificada
   ─────────────────────────────────────────────────────────────────────────── */
function findClosestParent(el, className) {
  if (el.classList && el.classList.contains(className)) {
    return el;
  }
  let parent = el.parentElement;
  while (parent) {
    if (parent.classList && parent.classList.contains(className)) {
      return parent;
    }
    parent = parent.parentElement;
  }
  return null;
}

/* ───────────────────────────────────────────────────────────────────────────
   6. Mover el div #fingerCursor
   ─────────────────────────────────────────────────────────────────────────── */
function moveFingerCursor(x, y) {
  if (!fingerCursor) return;
  const scaleX = window.innerWidth / 640;
  const scaleY = window.innerHeight / 480;
  fingerCursor.style.left = (x * scaleX) + 'px';
  fingerCursor.style.top = (y * scaleY) + 'px';
}

/* ───────────────────────────────────────────────────────────────────────────
   7. Simular mousemove en el elemento bajo el cursor
   ─────────────────────────────────────────────────────────────────────────── */
function simulateElementMouseMove(x, y) {
  const scaleX = window.innerWidth / 640;
  const scaleY = window.innerHeight / 480;
  const clientX = x * scaleX;
  const clientY = y * scaleY;
  const elem = document.elementFromPoint(clientX, clientY);
  if (elem) {
    const evt = new MouseEvent("mousemove", {
      bubbles: true,
      cancelable: true,
      clientX: clientX,
      clientY: clientY,
      view: window
    });
    elem.dispatchEvent(evt);
  }
}

/* ───────────────────────────────────────────────────────────────────────────
   8. Detectar si el dedo índice apunta hacia abajo
   ─────────────────────────────────────────────────────────────────────────── */
function isIndexPointingDown(landmarks) {
  const base = landmarks[6];
  const tip = landmarks[8];
  return tip[1] > base[1] + 45;
}

/* ───────────────────────────────────────────────────────────────────────────
   9. Detectar si el dedo índice apunta hacia arriba
   ─────────────────────────────────────────────────────────────────────────── */
function isIndexPointingUp(landmarks) {
  const base = landmarks[5];
  const tip = landmarks[8];
  return tip[1] < base[1] - 90;
}
