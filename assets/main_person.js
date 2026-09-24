    function poseJump(phase) {
      const p = emptyPose();

      let bodyY = 0;
      let hip = 0, knee = 0, worldFootTarget = 0;
      let armX = 0, chestX = 0;
      let footLocalOverride = null;

      if (phase < 0.20) {
        const k = phase / 0.20, e = k * k;
        bodyY  = -0.15 * e;
        hip    = -0.55 * e;
        knee   =  0.75 * e;
        armX   = -0.55 * e;
        chestX =  0.18 * e;
      } else if (phase < 0.32) {
        const k = (phase - 0.20) / 0.12;
        const e = 1 - (1 - k) * (1 - k);
        bodyY  = -0.15 * (1 - e) + 0.06 * e;
        hip    = -0.55 * (1 - e) + 0.30 * e;
        knee   =  0.75 * (1 - e) + 0.05 * e;
        worldFootTarget = 0.35 * e;
        armX   = -0.55 * (1 - e) + 1.70 * e;
        chestX =  0.18 * (1 - e) - 0.10 * e;
      } else if (phase < 0.72) {
        const k = (phase - 0.32) / 0.40;
        const arc = Math.sin(k * Math.PI);
        bodyY  = 0.06 + arc * 0.72;
        hip    = 0.30 - arc * 0.55;
        knee   = 0.05 + arc * 0.80;
        footLocalOverride = 0;
        armX   = 1.70 - arc * 0.40;
        chestX = -0.10 + arc * 0.12;
      } else if (phase < 0.88) {
        // LANDING: starts exactly from the pose at the end of airborne, so bodyY/hip/knee/arm
        // have no jump — otherwise the figure snaps to the top of the arc and back.
        const k = (phase - 0.72) / 0.16, e = k * k;
        bodyY  =  0.06  * (1 - e) - 0.15 * e;
        hip    =  0.30  * (1 - e) - 0.28 * e;
        knee   =  0.05  * (1 - e) + 0.85 * e;
        worldFootTarget = 0.35 * (1 - e);
        armX   =  1.70  * (1 - e) - 0.70 * e;
        chestX = -0.10  * (1 - e) + 0.26 * e;
      } else {
        const k = (phase - 0.88) / 0.12;
        const e = 1 - (1 - k) * (1 - k);
        bodyY  = -0.15 * (1 - e);
        hip    = -0.28 * (1 - e);
        knee   =  0.85 * (1 - e);
        armX   = -0.70 * (1 - e);
        chestX =  0.26 * (1 - e);
      }

      p.bodyY  = bodyY;
      p.hipLX  = hip; p.hipRX = hip;
      p.shinLX = knee; p.shinRX = knee;

      if (footLocalOverride !== null) {
        p.footLX = footLocalOverride;
        p.footRX = footLocalOverride;
      } else {
        p.footLX = worldFootTarget - hip - knee;
        p.footRX = worldFootTarget - hip - knee;
      }

      p.upLX = armX; p.upLZ = -0.12;
      p.upRX = armX; p.upRZ =  0.12;
      p.foLX = -0.35; p.foRX = -0.35;
      p.chestX = chestX;
      return p;
    }