import React, { useEffect, useRef } from 'react';

export default function ArenaVisualizer({
  gladiatorA,
  gladiatorB,
  isFighting,
  activeHpA,
  activeHpB,
  currentRoundEvents,
  roundHazard
}) {
  const canvasRef = useRef(null);
  
  const imagesRef = useRef({
    spartacus: null,
    crixus: null,
    gannicus: null,
    flamma: null
  });

  useEffect(() => {
    const loadImg = (name, src) => {
      const img = new Image();
      img.src = src;
      img.onload = () => {
        imagesRef.current[name] = img;
      };
    };
    loadImg('spartacus', '/spartacus.png');
    loadImg('crixus', '/crixus.png');
    loadImg('gannicus', '/gannicus.png');
    loadImg('flamma', '/flamma.png');
  }, []);

  const getGladiatorImage = (name, role) => {
    const lowerName = String(name || '').toLowerCase();
    if (lowerName.includes('spartacus')) return imagesRef.current.spartacus;
    if (lowerName.includes('crixus')) return imagesRef.current.crixus;
    if (lowerName.includes('gannicus')) return imagesRef.current.gannicus;
    if (lowerName.includes('flamma')) return imagesRef.current.flamma;
    
    // Role-based fallbacks
    if (role === 'Cyber-Retiarius' || role === 'Netrunner') return imagesRef.current.spartacus;
    if (role === 'Cyber-Dimachaerus' || role === 'Cyber-Samurai') return imagesRef.current.crixus;
    if (role === 'Cyber-Thraex') return imagesRef.current.gannicus;
    if (role === 'Cyber-Murmillo' || role === 'Mech-Tank') return imagesRef.current.flamma;
    
    return null;
  };

  const getRoleEmoji = (role) => {
    if (role === 'Cyber-Dimachaerus' || role === 'Cyber-Samurai') return '⚔️';
    if (role === 'Cyber-Retiarius' || role === 'Netrunner') return '⚡';
    if (role === 'Cyber-Thraex') return '🗡️';
    return '🛡️';
  };
  
  // Animation offsets
  const fighterOffsetARef = useRef(0);
  const fighterOffsetBRef = useRef(0);
  const lungeIntervalARef = useRef(null);
  const lungeIntervalBRef = useRef(null);
  const shakeIntensityRef = useRef(0);

  // References to keep track of animation objects
  const particlesRef = useRef([]);
  const floatersRef = useRef([]);
  const lasersRef = useRef([]);
  const shieldsRef = useRef([]); 
  const healsRef = useRef([]);   
  const tauntsRef = useRef([]);   // { target: 'A'|'B', text: string, life: number, maxLife: number }
  const hazardEffectRef = useRef(null); // { type, x, life, maxLife }
  
  // Background grid speed
  const gridOffsetRef = useRef(0);

  // Clean up lunge intervals on unmount
  useEffect(() => {
    return () => {
      if (lungeIntervalARef.current) clearInterval(lungeIntervalARef.current);
      if (lungeIntervalBRef.current) clearInterval(lungeIntervalBRef.current);
    };
  }, []);

  // Trigger animations when a new hazard is reported
  useEffect(() => {
    if (!roundHazard || !gladiatorA || !gladiatorB) return;

    const targetSide = roundHazard.targetId === gladiatorA.id ? 'A' : 'B';
    const targetX = targetSide === 'A' ? 120 : 480;
    const yVal = 100;

    hazardEffectRef.current = {
      type: roundHazard.type,
      x: targetX,
      life: 60,
      maxLife: 60
    };

    const color = roundHazard.type === 'LASER_GRID' ? '#ff3f34' : '#00ff87';
    spawnSparks(targetX, yVal, color, 20);
    shakeIntensityRef.current = roundHazard.type === 'LASER_GRID' ? 12 : 5;

    floatersRef.current.push({
      x: targetX,
      y: yVal - 40,
      text: roundHazard.type === 'LASER_GRID' ? `⚡ -10 HP (Laser)` : `🤢 Slowed (Sludge)`,
      color,
      life: 55,
      maxLife: 55
    });
  }, [roundHazard, gladiatorA, gladiatorB]);

  // Trigger animations when new events arrive
  useEffect(() => {
    if (!currentRoundEvents || currentRoundEvents.length === 0) return;

    const timeouts = [];

    currentRoundEvents.filter(Boolean).forEach((event, idx) => {
      const timer = setTimeout(() => {
        if (!gladiatorA || !gladiatorB) return;
        const isA = event.gladiatorId === gladiatorA.id;
        const targetSide = isA ? 'A' : 'B';
        const oppSide = isA ? 'B' : 'A';
        
        const sourceX = isA ? 120 : 480;
        const targetX = isA ? 480 : 120;
        const yVal = 100;

        // 1. Lunge animation
        if (event.action === 'ATTACK' || event.action === 'SPECIAL') {
          if (isA) {
            animateLunge('A');
          } else {
            animateLunge('B');
          }
        }

        // 2. Persona Taunt Bubble
        if (event.taunt) {
          // Clear previous taunts from the same side to avoid overlap
          tauntsRef.current = tauntsRef.current.filter(t => t.target !== targetSide);
          tauntsRef.current.push({
            target: targetSide,
            text: event.taunt,
            life: 120, // 2 seconds display
            maxLife: 120
          });
        }

        // 3. Action specific particles & effects
        if (event.action === 'ATTACK') {
          lasersRef.current.push({
            sx: sourceX, sy: yVal,
            tx: targetX, ty: yVal,
            type: 'slash',
            color: isA ? '#d4ff3e' : '#00e5ff',
            life: 10, maxLife: 10
          });

          if (event.damageDealt > 0) {
            spawnSparks(targetX, yVal, '#ff5252', 15);
            shakeIntensityRef.current = 5;
            floatersRef.current.push({
              x: targetX, y: yVal - 30,
              text: `-${event.damageDealt} HP`,
              color: '#ff5252',
              life: 45, maxLife: 45
            });
          }
        } 
        else if (event.action === 'SPECIAL') {
          const hit = event.damageDealt > 0;
          
          lasersRef.current.push({
            sx: sourceX, sy: yVal,
            tx: hit ? targetX : (isA ? 600 : 0), 
            ty: hit ? yVal : yVal + (Math.random() * 40 - 20),
            type: 'laser',
            color: isA ? '#ffd32a' : '#ff3f34',
            life: 15, maxLife: 15
          });

          if (hit) {
            spawnSparks(targetX, yVal, '#ffd32a', 30);
            shakeIntensityRef.current = 15; 
            floatersRef.current.push({
              x: targetX, y: yVal - 35,
              text: `💥 -${event.damageDealt} HP`,
              color: '#ffd32a',
              life: 50, maxLife: 50
            });
          } else {
            spawnSparks(isA ? 400 : 200, yVal, '#999', 5);
            floatersRef.current.push({
              x: targetX, y: yVal - 30,
              text: 'MISS',
              color: '#a0a0a0',
              life: 40, maxLife: 40
            });
          }
        }
        else if (event.action === 'DEFEND') {
          shieldsRef.current.push({
            target: targetSide,
            life: 25, maxLife: 25
          });
          spawnSparks(sourceX, yVal, '#00e5ff', 8);
          floatersRef.current.push({
            x: sourceX, y: yVal - 30,
            text: 'DEFEND',
            color: '#00e5ff',
            life: 30, maxLife: 30
          });
        }
        else if (event.action === 'HEAL') {
          healsRef.current.push({
            target: targetSide,
            life: 25, maxLife: 25
          });
          spawnSparks(sourceX, yVal, '#00ff87', 15);
          floatersRef.current.push({
            x: sourceX, y: yVal - 30,
            text: `💚 +${event.healingDone || 0} HP`,
            color: '#00ff87',
            life: 45, maxLife: 45
          });
        }

      }, idx * 350); 
      timeouts.push(timer);
    });

    return () => {
      timeouts.forEach(clearTimeout);
    };
  }, [currentRoundEvents, gladiatorA, gladiatorB]);

  // Helper for lunge
  const animateLunge = (side) => {
    let tick = 0;
    const intervalRef = side === 'A' ? lungeIntervalARef : lungeIntervalBRef;
    const offsetRef = side === 'A' ? fighterOffsetARef : fighterOffsetBRef;

    if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }

    intervalRef.current = setInterval(() => {
      tick++;
      const maxOffset = 50;
      let offset = 0;
      if (tick <= 5) {
        offset = (tick / 5) * maxOffset;
      } else if (tick <= 12) {
        offset = maxOffset - ((tick - 5) / 7) * maxOffset;
      } else {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      
      offsetRef.current = side === 'A' ? offset : -offset;
    }, 16);
  };

  // Helper to spawn particle sparks
  const spawnSparks = (x, y, color, count) => {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 1 + Math.random() * 4;
      particlesRef.current.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 1, 
        color,
        size: 1.5 + Math.random() * 2,
        life: 20 + Math.random() * 20,
        maxLife: 40
      });
    }
  };

  // Canvas main rendering loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    let animationFrameId;
    
    const render = () => {
      let shakeX = 0;
      let shakeY = 0;
      if (shakeIntensityRef.current > 0) {
        shakeX = (Math.random() * 2 - 1) * shakeIntensityRef.current;
        shakeY = (Math.random() * 2 - 1) * shakeIntensityRef.current;
        shakeIntensityRef.current = Math.max(0, shakeIntensityRef.current - 0.5);
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      ctx.translate(shakeX, shakeY);

      // --- Draw Grid Background ---
      gridOffsetRef.current = (gridOffsetRef.current + 0.5) % 40;
      ctx.strokeStyle = 'rgba(212, 255, 62, 0.035)';
      ctx.lineWidth = 1;
      
      for (let x = gridOffsetRef.current; x < canvas.width; x += 40) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, canvas.height);
        ctx.stroke();
      }
      for (let y = 0; y < canvas.height; y += 40) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(canvas.width, y);
        ctx.stroke();
      }

      // Draw middle dividing line
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.moveTo(300, 0);
      ctx.lineTo(300, canvas.height);
      ctx.stroke();
      ctx.setLineDash([]); 

      // --- Coordinates ---
      const xA = 120 + fighterOffsetARef.current;
      const xB = 480 + fighterOffsetBRef.current;
      const yVal = 100;

      // --- Draw Active Environmental Hazard ---
      if (hazardEffectRef.current) {
        const h = hazardEffectRef.current;
        h.life--;
        if (h.life > 0) {
          ctx.save();
          ctx.strokeStyle = h.type === 'LASER_GRID' ? `rgba(255, 63, 52, ${h.life / h.maxLife})` : `rgba(0, 255, 135, ${h.life / h.maxLife})`;
          ctx.lineWidth = h.type === 'LASER_GRID' ? 3 : 2;
          ctx.shadowBlur = 15;
          ctx.shadowColor = h.type === 'LASER_GRID' ? '#ff3f34' : '#00ff87';

          if (h.type === 'LASER_GRID') {
            ctx.beginPath();
            ctx.moveTo(h.x - 30, 20); ctx.lineTo(h.x + 30, 180);
            ctx.moveTo(h.x + 30, 20); ctx.lineTo(h.x - 30, 180);
            ctx.stroke();
          } else {
            ctx.fillStyle = `rgba(0, 255, 135, ${0.2 * (h.life / h.maxLife)})`;
            ctx.beginPath();
            ctx.ellipse(h.x, yVal + 28, 35, 10, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
          }
          ctx.restore();
        } else {
          hazardEffectRef.current = null;
        }
      }

      // --- Draw Lasers/Slashes ---
      lasersRef.current = lasersRef.current.filter(l => {
        l.life--;
        if (l.life <= 0) return false;
        ctx.save();
        if (l.type === 'slash') {
          ctx.strokeStyle = l.color;
          ctx.lineWidth = Math.max(0.5, 3 * (l.life / l.maxLife));
          ctx.shadowBlur = 10;
          ctx.shadowColor = l.color;
          ctx.beginPath();
          const progress = 1 - (l.life / l.maxLife);
          const currentX = l.sx + (l.tx - l.sx) * progress;
          ctx.arc(currentX, yVal, 20, -Math.PI / 4, Math.PI / 4);
          ctx.stroke();
        } else if (l.type === 'laser') {
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = Math.max(0.5, 4 * (l.life / l.maxLife));
          ctx.shadowBlur = 15;
          ctx.shadowColor = l.color;
          ctx.beginPath();
          ctx.moveTo(l.sx, l.sy);
          ctx.lineTo(l.tx, l.ty);
          ctx.stroke();

          ctx.strokeStyle = l.color;
          ctx.lineWidth = Math.max(0.5, 8 * (l.life / l.maxLife));
          ctx.beginPath();
          ctx.moveTo(l.sx, l.sy);
          ctx.lineTo(l.tx, l.ty);
          ctx.stroke();
        }
        ctx.restore();
        return l.life > 0;
      });

      // --- Draw Fighter A ---
      if (gladiatorA) {
        ctx.save();
        ctx.translate(xA, yVal);
        
        ctx.fillStyle = 'rgba(18, 16, 14, 0.6)';
        ctx.strokeStyle = '#d4ff3e';
        ctx.lineWidth = 2;
        ctx.shadowBlur = 10;
        ctx.shadowColor = '#d4ff3e';
        ctx.beginPath();
        ctx.ellipse(0, 30, 30, 8, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.font = '3rem Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.shadowBlur = 0; 
        
        const floatY = Math.sin(Date.now() / 150) * 4;
        const img = getGladiatorImage(gladiatorA.name, gladiatorA.role);
        if (img) {
          ctx.save();
          ctx.beginPath();
          ctx.roundRect(-24, floatY - 34, 48, 48, 4);
          ctx.clip();
          ctx.drawImage(img, -24, floatY - 34, 48, 48);
          ctx.restore();
          
          ctx.strokeStyle = '#d4ff3e';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.roundRect(-24, floatY - 34, 48, 48, 4);
          ctx.stroke();
        } else {
          ctx.fillText(getRoleEmoji(gladiatorA.role), 0, floatY - 10);
        }
        ctx.restore();
      }

      // --- Draw Fighter B ---
      if (gladiatorB) {
        ctx.save();
        ctx.translate(xB, yVal);
        
        ctx.fillStyle = 'rgba(18, 16, 14, 0.6)';
        ctx.strokeStyle = '#00e5ff';
        ctx.lineWidth = 2;
        ctx.shadowBlur = 10;
        ctx.shadowColor = '#00e5ff';
        ctx.beginPath();
        ctx.ellipse(0, 30, 30, 8, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.font = '3rem Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.shadowBlur = 0;

        const floatY = Math.sin(Date.now() / 150 + Math.PI) * 4; 
        const img = getGladiatorImage(gladiatorB.name, gladiatorB.role);
        if (img) {
          ctx.save();
          ctx.beginPath();
          ctx.roundRect(-24, floatY - 34, 48, 48, 4);
          ctx.clip();
          ctx.drawImage(img, -24, floatY - 34, 48, 48);
          ctx.restore();
          
          ctx.strokeStyle = '#00e5ff';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.roundRect(-24, floatY - 34, 48, 48, 4);
          ctx.stroke();
        } else {
          ctx.fillText(getRoleEmoji(gladiatorB.role), 0, floatY - 10);
        }
        ctx.restore();
      }

      // --- Draw Shield Bubbles ---
      shieldsRef.current = shieldsRef.current.filter(s => {
        s.life--;
        if (s.life <= 0) return false;
        const x = s.target === 'A' ? xA : xB;
        ctx.save();
        ctx.strokeStyle = `rgba(0, 229, 255, ${s.life / s.maxLife})`;
        ctx.fillStyle = `rgba(0, 229, 255, ${0.1 * (s.life / s.maxLife)})`;
        ctx.lineWidth = 3;
        ctx.shadowBlur = 10;
        ctx.shadowColor = '#00e5ff';
        ctx.beginPath();
        ctx.arc(x, yVal - 10, 32, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
        return s.life > 0;
      });

      // --- Draw Healing Glows ---
      healsRef.current = healsRef.current.filter(h => {
        h.life--;
        if (h.life <= 0) return false;
        const x = h.target === 'A' ? xA : xB;
        ctx.save();
        ctx.strokeStyle = `rgba(0, 255, 135, ${h.life / h.maxLife})`;
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 2]);
        ctx.shadowBlur = 10;
        ctx.shadowColor = '#00ff87';
        ctx.beginPath();
        ctx.arc(x, yVal - 10, Math.max(0, 35 - (10 * (h.life / h.maxLife))), 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
        return h.life > 0;
      });

      // --- Draw Particles ---
      particlesRef.current = particlesRef.current.filter(p => {
        p.life--;
        if (p.life <= 0) return false;
        p.x += p.vx;
        p.y += p.vy;
        ctx.fillStyle = p.color;
        ctx.shadowBlur = 4;
        ctx.shadowColor = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(0, p.size * (p.life / p.maxLife)), 0, Math.PI * 2);
        ctx.fill();
        return true;
      });
      ctx.shadowBlur = 0; 

      // --- Draw Floating Text ---
      floatersRef.current = floatersRef.current.filter(f => {
        f.life--;
        if (f.life <= 0) return false;
        f.y -= 0.6; 
        ctx.save();
        ctx.font = 'bold 0.8rem monospace';
        ctx.fillStyle = f.color;
        ctx.textAlign = 'center';
        ctx.shadowBlur = 6;
        ctx.shadowColor = f.color;
        ctx.fillText(f.text, f.x, f.y);
        ctx.restore();
        return true;
      });

      // --- Draw Fighter Taunt Speech Bubbles ---
      tauntsRef.current = tauntsRef.current.filter(t => {
        t.life--;
        if (t.life <= 0) return false;
        const x = t.target === 'A' ? xA : xB;
        const y = yVal - 42; 
        
        ctx.save();
        ctx.font = 'bold 0.65rem monospace';
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        
        const bubbleWidth = ctx.measureText(t.text).width + 16;
        const bubbleHeight = 20;
        const rx = x - bubbleWidth / 2;
        const ry = y - bubbleHeight;
        
        ctx.fillStyle = 'rgba(12, 10, 8, 0.95)';
        ctx.strokeStyle = t.target === 'A' ? '#d4ff3e' : '#00e5ff';
        ctx.lineWidth = 1.5;
        ctx.shadowBlur = 5;
        ctx.shadowColor = ctx.strokeStyle;
        
        ctx.beginPath();
        ctx.roundRect(rx, ry, bubbleWidth, bubbleHeight, 4);
        ctx.fill();
        ctx.stroke();
        
        ctx.beginPath();
        ctx.moveTo(x - 4, y);
        ctx.lineTo(x + 4, y);
        ctx.lineTo(x, y + 5);
        ctx.closePath();
        ctx.fillStyle = 'rgba(12, 10, 8, 0.95)';
        ctx.fill();
        ctx.stroke();
        
        ctx.fillStyle = '#ffffff';
        ctx.textBaseline = 'middle';
        ctx.fillText(t.text, x, ry + bubbleHeight / 2);
        ctx.restore();
        
        return true;
      });

      // --- Draw VS Text ---
      if (!isFighting) {
        ctx.save();
        ctx.font = 'bold 1.2rem monospace';
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.shadowBlur = 10;
        ctx.shadowColor = '#fff';
        ctx.fillText('VS', 300, yVal);
        ctx.restore();
      }

      ctx.restore(); 
      animationFrameId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [gladiatorA, gladiatorB, isFighting]);

  return (
    <div style={{ width: '100%', height: '200px', background: '#000000', position: 'relative' }}>
      <canvas
        ref={canvasRef}
        width={600}
        height={200}
        style={{
          width: '100%',
          height: '100%',
          display: 'block'
        }}
      />

      {/* Retro HUD overlay panels */}
      <div style={{ position: 'absolute', top: '10px', left: '10px', pointerEvents: 'none', fontFamily: 'monospace', fontSize: '0.6rem', color: '#d4ff3e', textShadow: '0 0 4px rgba(212,255,62,0.5)' }}>
        SYS_L: {gladiatorA?.name ? String(gladiatorA.name).toUpperCase() : 'NO_SIGNAL'}
        <br />
        HP: {activeHpA}%
      </div>

      <div style={{ position: 'absolute', top: '10px', right: '10px', pointerEvents: 'none', fontFamily: 'monospace', fontSize: '0.6rem', color: '#00e5ff', textAlign: 'right', textShadow: '0 0 4px rgba(0,229,255,0.5)' }}>
        SYS_R: {gladiatorB?.name ? String(gladiatorB.name).toUpperCase() : 'NO_SIGNAL'}
        <br />
        HP: {activeHpB}%
      </div>

      <div style={{ position: 'absolute', bottom: '10px', left: '50%', transform: 'translateX(-50%)', pointerEvents: 'none', fontFamily: 'monospace', fontSize: '0.55rem', color: 'rgba(255,255,255,0.3)', letterSpacing: '2px' }}>
        {isFighting ? 'COMBAT_SIMULATOR_ACTIVE' : 'ARENA_AWAITING_INPUT'}
      </div>
    </div>
  );
}
