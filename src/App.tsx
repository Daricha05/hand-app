import { useEffect, useRef, useState } from "react";
import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";

function distance(a: any, b: any) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [handLandmarker, setHandLandmarker] = useState<HandLandmarker | null>(null);
  const draggedElementRef = useRef<HTMLElement | null>(null);

  // élément sous le curseur (viewport)
  const getElementUnderCursor = (x: number, y: number) => {
    const els = document.elementsFromPoint(x, y) as HTMLElement[];
    return els.find(el => el.classList.contains("draggable")) || null;
  };

  // dropzone sous le curseur
  const getDropZoneUnderCursor = (x: number, y: number) => {
    const els = document.elementsFromPoint(x, y) as HTMLElement[];
    return els.find(el => el.classList.contains("dropzone")) || null;
  };

  // logique pinch / drag
  const handlePinch = (cursorX: number, cursorY: number, isPinching: boolean) => {
    if (isPinching) {
      if (!draggedElementRef.current) {
        const el = getElementUnderCursor(cursorX, cursorY);
        if (el) {
          draggedElementRef.current = el;
          el.style.position = "absolute";
          el.style.zIndex = "1000";
          el.style.boxShadow = "0 0 10px 3px gold";
        }
      } else {
        // déplacement
        const el = draggedElementRef.current;
        el.style.left = `${cursorX - el.offsetWidth / 2}px`;
        el.style.top = `${cursorY - el.offsetHeight / 2}px`;
      }
    } else {
      // relâcher
      if (draggedElementRef.current) {
        const el = draggedElementRef.current;
        const drop = getDropZoneUnderCursor(
          el.offsetLeft + el.offsetWidth / 2,
          el.offsetTop + el.offsetHeight / 2
        );
        if (drop) {
          alert(`Élément "${el.innerText}" déposé dans "${drop.innerText}" !`);
          el.style.left = `${drop.offsetLeft + drop.offsetWidth / 2 - el.offsetWidth / 2}px`;
          el.style.top = `${drop.offsetTop + drop.offsetHeight / 2 - el.offsetHeight / 2}px`;
        }
        el.style.boxShadow = "none";
        draggedElementRef.current = null;
      }
    }
  };

  // ----- Chargement unique (caméra + modèle) -----
  useEffect(() => {
    let raf = 0;

    async function init() {
      // 1. modèle
      const vision = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.4/wasm"
      );
      const model = await HandLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: "/models/hand_landmarker.task", // <-- ton fichier local
          delegate: "GPU",
        },
        numHands: 1,
        runningMode: "VIDEO",
      });
      setHandLandmarker(model);

      // 2. caméra
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 } },
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      // 3. boucle de détection
      const video = videoRef.current!;
      const canvas = canvasRef.current!;
      const ctx = canvas.getContext("2d")!;

      const detect = (time: number) => {
        if (!model || video.readyState < 2) {
          raf = requestAnimationFrame(detect);
          return;
        }
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        const results = model.detectForVideo(video, time);
        if (results.landmarks.length) {
          results.landmarks.forEach(lm => {
            lm.forEach(pt => {
              ctx.beginPath();
              ctx.arc(pt.x * canvas.width, pt.y * canvas.height, 5, 0, 2 * Math.PI);
              ctx.fillStyle = "lime";
              ctx.fill();
            });

            // curseur + pinch
            const indexTip = lm[8];
            const thumbTip = lm[4];
            const dist = distance(thumbTip, indexTip);
            const isPinching = dist < 0.05;

            const cursor = document.getElementById("cursor") as HTMLElement | null;
            if (cursor) {
              // coordonnées viewport (scroll-safe)
              const rect = video.getBoundingClientRect();
              const vx = rect.left + indexTip.x * rect.width;
              const vy = rect.top + indexTip.y * rect.height;

              cursor.style.left = `${vx}px`;
              cursor.style.top = `${vy}px`;
              cursor.style.background = isPinching ? "yellow" : "red";

              handlePinch(vx, vy, isPinching);
            }
          });
        }
        raf = requestAnimationFrame(detect);
      };
      raf = requestAnimationFrame(detect);
    }

    init().catch(console.error);

    // cleanup
    return () => {
      cancelAnimationFrame(raf);
      if (videoRef.current?.srcObject) {
        (videoRef.current.srcObject as MediaStream).getTracks().forEach(t => t.stop());
      }
    };
  }, []);

  return (
    <div style={{ textAlign: "center", padding: "20px" }}>
      <h2>Hand Tracking — Drag & Drop + DropZones</h2>
      <div
        style={{
          position: "relative",
          width: "100%",
          height: "100%",
          maxWidth: "100%",
          maxHeight: "100%",
        }}>
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          style={{ width: "100%", maxWidth: "100%", borderRadius: "10px" }} />

        <canvas
          ref={canvasRef}
          style={{ position: "absolute", left: 0, top: 0, width: "100%", maxWidth: "100%" }} />

        {/* Draggables */}
        <div
          className="draggable"
          style={{
            position: "absolute",
            top: "15%",
            left: "10%",
            width: "80px",
            height: "80px",
            background: "skyblue",
            borderRadius: "10px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontWeight: "bold",
            cursor: "grab",
          }}
        >
          Drag Me
        </div>
        <div
          className="draggable"
          style={{
            position: "absolute",
            top: "35%",
            left: "25%",
            width: "80px",
            height: "80px",
            background: "salmon",
            borderRadius: "10px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontWeight: "bold",
            cursor: "grab",
          }}
        >
          Drag Me Too
        </div>
        
        {/* Drop zones */}
        <div className="dropzone" style={{ position: "absolute", bottom: "20px", left: "50px", width: "150px", height: "100px", background: "lightgreen", borderRadius: "10px", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: "bold" }}>Drop Zone 1</div>
        <div className="dropzone" style={{ position: "absolute", bottom: "20px", right: "50px", width: "150px", height: "100px", background: "lightcoral", borderRadius: "10px", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: "bold" }}>Drop Zone 2</div>
      </div>

      {/* Curseur main */}
      <div id="cursor" style={{ position: "fixed", width: "20px", height: "20px", borderRadius: "50%", background: "red", transform: "translate(-50%, -50%)", pointerEvents: "none", zIndex: 9999 }} />
    </div>
  );
}

export default App;