import { useEffect, useRef, useState } from "react";
import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";

function distance(a: any, b: any) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

interface EditorState {
  isOpen: boolean;
  element: HTMLElement | null;
  content: string;
  position: { x: number; y: number };
}

function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [handLandmarker, setHandLandmarker] = useState<HandLandmarker | null>(null);
  const draggedElementRef = useRef<HTMLElement | null>(null);
  
  // Gestion de l'éditeur
  const [editor, setEditor] = useState<EditorState>({
    isOpen: false,
    element: null,
    content: "",
    position: { x: 0, y: 0 }
  });
  
  // Gestion du double-clic
  const lastClickTimeRef = useRef<number>(0);
  const lastClickPositionRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const doubleClickThreshold = 500; // ms
  const doubleClickDistanceThreshold = 20; // pixels

  // élément sous le curseur (viewport)
  const getElementUnderCursor = (x: number, y: number) => {
    const els = document.elementsFromPoint(x, y) as HTMLElement[];
    return els.find(el => el.classList.contains("draggable") || el.classList.contains("dropped")) || null;
  };

  // dropzone sous le curseur
  const getDropZoneUnderCursor = (x: number, y: number) => {
    const els = document.elementsFromPoint(x, y) as HTMLElement[];
    return els.find(el => el.classList.contains("dropzone")) || null;
  };

  // Ouvrir l'éditeur
  const openEditor = (element: HTMLElement, x: number, y: number) => {
    setEditor({
      isOpen: true,
      element,
      content: element.innerText,
      position: { x: Math.max(10, x - 150), y: Math.max(10, y - 150) }
    });
  };

  // Fermer l'éditeur
  const closeEditor = () => {
    if (editor.element && editor.content.trim()) {
      editor.element.innerText = editor.content;
      
      // Marquer comme élément éditable/déplaçable
      if (!editor.element.classList.contains("draggable")) {
        editor.element.classList.add("dropped");
        editor.element.style.cursor = "grab";
      }
    }
    
    setEditor({
      isOpen: false,
      element: null,
      content: "",
      position: { x: 0, y: 0 }
    });
  };

  // Gestion du double-clic
  const handleDoubleClickCheck = (cursorX: number, cursorY: number) => {
    const now = Date.now();
    const lastClickTime = lastClickTimeRef.current;
    const lastClickPosition = lastClickPositionRef.current;
    
    const distanceFromLastClick = Math.sqrt(
      Math.pow(cursorX - lastClickPosition.x, 2) + 
      Math.pow(cursorY - lastClickPosition.y, 2)
    );
    
    // Vérifier si c'est un double-clic
    if (
      now - lastClickTime < doubleClickThreshold &&
      distanceFromLastClick < doubleClickDistanceThreshold
    ) {
      const element = getElementUnderCursor(cursorX, cursorY);
      if (element && (element.classList.contains("draggable") || element.classList.contains("dropped"))) {
        openEditor(element, cursorX, cursorY);
        lastClickTimeRef.current = 0; // Réinitialiser pour éviter les triples clics
        return true;
      }
    }
    
    // Mettre à jour le dernier clic
    lastClickTimeRef.current = now;
    lastClickPositionRef.current = { x: cursorX, y: cursorY };
    return false;
  };

  // logique pinch / drag
  const handlePinch = (cursorX: number, cursorY: number, isPinching: boolean) => {
    if (isPinching) {
      // Vérifier d'abord si on ne tente pas un double-clic
      const wasDoubleClick = handleDoubleClickCheck(cursorX, cursorY);
      if (wasDoubleClick) return;
      
      if (!draggedElementRef.current) {
        const el = getElementUnderCursor(cursorX, cursorY);
        if (el) {
          draggedElementRef.current = el;
          el.style.position = "absolute";
          el.style.zIndex = "1000";
          el.style.boxShadow = "0 0 15px 5px rgba(255,215,0,0.8)";
          el.style.transform = "scale(1.1)";
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
          el.style.left = `${drop.offsetLeft + drop.offsetWidth / 2 - el.offsetWidth / 2}px`;
          el.style.top = `${drop.offsetTop + drop.offsetHeight / 2 - el.offsetHeight / 2}px`;
          
          // Marquer comme élément éditable
          el.classList.add("dropped");
          el.classList.remove("draggable");
          
          // Feedback visuel
          drop.style.boxShadow = "0 0 20px 8px rgba(0,255,0,0.7)";
          drop.style.transform = "scale(1.05)";
          setTimeout(() => {
            drop.style.boxShadow = "";
            drop.style.transform = "";
          }, 500);
        }
        el.style.boxShadow = "none";
        el.style.transform = "scale(1)";
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
          modelAssetPath: "/models/hand_landmarker.task",
          delegate: "GPU",
        },
        numHands: 1,
        runningMode: "VIDEO",
      });
      setHandLandmarker(model);

      // 2. caméra
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 } }, // Augmenté la résolution
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
              ctx.arc(pt.x * canvas.width, pt.y * canvas.height, 8, 0, 2 * Math.PI); // Points plus gros
              ctx.fillStyle = "rgba(50, 205, 50, 0.8)";
              ctx.fill();
              ctx.strokeStyle = "white";
              ctx.lineWidth = 2;
              ctx.stroke();
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
              cursor.style.background = isPinching ? "gold" : "rgba(255, 0, 0, 0.8)";
              cursor.style.transform = isPinching 
                ? "translate(-50%, -50%) scale(2)" 
                : "translate(-50%, -50%) scale(1.5)";
              cursor.style.boxShadow = isPinching 
                ? "0 0 20px 10px rgba(255,215,0,0.5)" 
                : "0 0 15px 5px rgba(255,0,0,0.3)";

              if (!editor.isOpen) {
                handlePinch(vx, vy, isPinching);
              }
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
  }, [editor.isOpen]);

  // Gérer la touche Escape pour fermer l'éditeur
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && editor.isOpen) {
        closeEditor();
      }
    };
    
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [editor.isOpen]);

  return (
    <div style={{ 
      display: "flex", 
      flexDirection: "column", 
      alignItems: "center", 
      justifyContent: "center",
      minHeight: "100vh",
      padding: "20px",
      backgroundColor: "#f0f2f5",
      background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
    }}>
      <div style={{
        width: "100%",
        maxWidth: "1400px", // Largeur augmentée
        margin: "0 auto",
      }}>
        <div style={{
          background: "white",
          borderRadius: "20px",
          padding: "30px",
          boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
          marginBottom: "30px",
        }}>
          <h1 style={{ 
            marginTop: 0, 
            marginBottom: "10px",
            fontSize: "2.5rem",
            background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            textAlign: "center",
          }}>
            Hand Tracking — Drag & Drop + Édition
          </h1>
          <p style={{ 
            color: "#666", 
            marginBottom: "25px",
            fontSize: "1.1rem",
            textAlign: "center",
            lineHeight: "1.6",
          }}>
            <strong>Instructions :</strong> Déplacer = Pinch-maintenir • Éditer = Double-pinch rapide
          </p>
        </div>
        
        <div ref={containerRef}
          style={{
            position: "relative",
            width: "100%",
            height: "700px", // Hauteur augmentée
            backgroundColor: "white",
            borderRadius: "20px",
            overflow: "hidden",
            boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
          }}>
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            style={{ 
              width: "100%", 
              height: "100%", 
              objectFit: "cover",
              borderRadius: "20px" 
            }} />

          <canvas
            ref={canvasRef}
            style={{ 
              position: "absolute", 
              left: 0, 
              top: 0, 
              width: "100%", 
              height: "100%",
              borderRadius: "20px"
            }} />

          {/* Draggables */}
          <div
            className="draggable"
            style={{
              position: "absolute",
              top: "15%",
              left: "15%",
              width: "120px", // Taille augmentée
              height: "120px",
              background: "linear-gradient(135deg, #36d1dc, #5b86e5)",
              borderRadius: "15px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: "bold",
              cursor: "grab",
              color: "white",
              textShadow: "2px 2px 4px rgba(0,0,0,0.3)",
              transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
              padding: "15px",
              textAlign: "center",
              fontSize: "1.2rem",
              border: "3px solid white",
              boxShadow: "0 10px 30px rgba(0,0,0,0.2)",
            }}
            onMouseEnter={(e) => e.currentTarget.style.transform = "scale(1.1) translateY(-5px)"}
            onMouseLeave={(e) => e.currentTarget.style.transform = "scale(1) translateY(0)"}
          >
            Drag Me
          </div>
          <div
            className="draggable"
            style={{
              position: "absolute",
              top: "35%",
              left: "30%",
              width: "120px",
              height: "120px",
              background: "linear-gradient(135deg, #ff9a9e, #fad0c4)",
              borderRadius: "15px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: "bold",
              cursor: "grab",
              color: "white",
              textShadow: "2px 2px 4px rgba(0,0,0,0.3)",
              transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
              padding: "15px",
              textAlign: "center",
              fontSize: "1.2rem",
              border: "3px solid white",
              boxShadow: "0 10px 30px rgba(0,0,0,0.2)",
            }}
            onMouseEnter={(e) => e.currentTarget.style.transform = "scale(1.1) translateY(-5px)"}
            onMouseLeave={(e) => e.currentTarget.style.transform = "scale(1) translateY(0)"}
          >
            Drag Me Too
          </div>
          
          {/* Drop zones */}
          <div className="dropzone" style={{ 
            position: "absolute", 
            bottom: "40px", 
            left: "100px", 
            width: "200px", // Taille augmentée
            height: "150px",
            background: "linear-gradient(135deg, #56ab2f, #a8e063)",
            borderRadius: "15px", 
            display: "flex", 
            alignItems: "center", 
            justifyContent: "center", 
            fontWeight: "bold",
            color: "white",
            textShadow: "2px 2px 4px rgba(0,0,0,0.3)",
            transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
            fontSize: "1.3rem",
            border: "3px dashed rgba(255,255,255,0.5)",
            boxShadow: "0 10px 30px rgba(0,0,0,0.15)",
          }}>
            <div style={{ textAlign: "center" }}>
              <div>📁</div>
              <div>Drop Zone 1</div>
            </div>
          </div>
          
          <div className="dropzone" style={{ 
            position: "absolute", 
            bottom: "40px", 
            right: "100px", 
            width: "200px", 
            height: "150px", 
            background: "linear-gradient(135deg, #ff6b6b, #ffa8a8)",
            borderRadius: "15px", 
            display: "flex", 
            alignItems: "center", 
            justifyContent: "center", 
            fontWeight: "bold",
            color: "white",
            textShadow: "2px 2px 4px rgba(0,0,0,0.3)",
            transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
            fontSize: "1.3rem",
            border: "3px dashed rgba(255,255,255,0.5)",
            boxShadow: "0 10px 30px rgba(0,0,0,0.15)",
          }}>
            <div style={{ textAlign: "center" }}>
              <div>📂</div>
              <div>Drop Zone 2</div>
            </div>
          </div>
        </div>

        {/* Éditeur de texte */}
        {editor.isOpen && (
          <div style={{
            position: "fixed",
            left: "50%",
            top: "50%",
            transform: "translate(-50%, -50%)",
            background: "white",
            borderRadius: "20px",
            boxShadow: "0 25px 50px rgba(0,0,0,0.4)",
            padding: "30px",
            zIndex: 10001,
            minWidth: "400px",
            maxWidth: "500px",
            width: "90%",
          }}>
            <h3 style={{ 
              marginTop: 0, 
              marginBottom: "20px",
              fontSize: "1.8rem",
              color: "#333",
              textAlign: "center",
            }}>✏️ Éditer le texte</h3>
            <textarea
              autoFocus
              value={editor.content}
              onChange={(e) => setEditor(prev => ({ ...prev, content: e.target.value }))}
              style={{
                width: "100%",
                height: "150px",
                padding: "15px",
                borderRadius: "10px",
                border: "3px solid #667eea",
                fontSize: "1.1rem",
                resize: "vertical",
                marginBottom: "20px",
                fontFamily: "inherit",
                outline: "none",
                transition: "border 0.3s",
              }}
              onFocus={(e) => e.target.style.borderColor = "#764ba2"}
              onBlur={(e) => e.target.style.borderColor = "#667eea"}
              placeholder="Saisissez votre texte ici..."
            />
            <div style={{ display: "flex", gap: "15px", justifyContent: "center" }}>
              <button
                onClick={closeEditor}
                style={{
                  padding: "12px 25px",
                  background: "linear-gradient(135deg, #6c757d, #495057)",
                  color: "white",
                  border: "none",
                  borderRadius: "10px",
                  cursor: "pointer",
                  fontSize: "1rem",
                  fontWeight: "bold",
                  transition: "all 0.3s",
                  minWidth: "120px",
                }}
                onMouseEnter={(e) => e.currentTarget.style.transform = "translateY(-2px)"}
                onMouseLeave={(e) => e.currentTarget.style.transform = "translateY(0)"}
              >
                Annuler
              </button>
              <button
                onClick={closeEditor}
                style={{
                  padding: "12px 25px",
                  background: "linear-gradient(135deg, #667eea, #764ba2)",
                  color: "white",
                  border: "none",
                  borderRadius: "10px",
                  cursor: "pointer",
                  fontSize: "1rem",
                  fontWeight: "bold",
                  transition: "all 0.3s",
                  minWidth: "120px",
                }}
                onMouseEnter={(e) => e.currentTarget.style.transform = "translateY(-2px)"}
                onMouseLeave={(e) => e.currentTarget.style.transform = "translateY(0)"}
              >
                Enregistrer
              </button>
            </div>
            <div style={{
              position: "absolute",
              top: "15px",
              right: "15px",
              background: "linear-gradient(135deg, #667eea, #764ba2)",
              borderRadius: "50%",
              width: "40px",
              height: "40px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              fontWeight: "bold",
              color: "white",
              fontSize: "1.5rem",
              transition: "all 0.3s",
            }} 
            onClick={closeEditor} 
            title="Fermer (Esc)"
            onMouseEnter={(e) => e.currentTarget.style.transform = "rotate(90deg) scale(1.1)"}
            onMouseLeave={(e) => e.currentTarget.style.transform = "rotate(0) scale(1)"}
            >
              ×
            </div>
          </div>
        )}

        {/* Curseur main */}
        <div id="cursor" style={{ 
          position: "fixed", 
          width: "30px", // Taille augmentée
          height: "30px", 
          borderRadius: "50%", 
          background: "rgba(255, 0, 0, 0.8)", 
          transform: "translate(-50%, -50%)", 
          pointerEvents: "none", 
          zIndex: 9999,
          transition: "all 0.15s cubic-bezier(0.4, 0, 0.2, 1)",
          border: "3px solid white",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: "0.7rem",
          fontWeight: "bold",
          color: "white",
          textShadow: "1px 1px 2px rgba(0,0,0,0.5)",
        }} />
        
        {/* Overlay pour bloquer les interactions quand l'éditeur est ouvert */}
        {editor.isOpen && (
          <div style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 10000,
            background: "rgba(0,0,0,0.5)",
            backdropFilter: "blur(3px)",
            pointerEvents: "auto",
          }} onClick={closeEditor} />
        )}

        {/* Pied de page */}
        <div style={{
          marginTop: "30px",
          textAlign: "center",
          color: "white",
          fontSize: "0.9rem",
          opacity: 0.8,
        }}>
          <p>Utilisez votre main pour interagir avec les éléments. Le curseur rouge suit votre index.</p>
        </div>
      </div>
    </div>
  );
}

export default App;