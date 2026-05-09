<script setup>
import { computed } from 'vue'

const props = defineProps({
  flipp: { type: Object, required: true },
})

const emit = defineEmits(['restart', 'exit'])

const levelStr = computed(() => `LEVEL ${String(props.flipp.level.value).padStart(2, '0')}`)
const scoreStr = computed(() => `SCORE ${String(props.flipp.score.value).padStart(5, '0')}`)
const heartCount = computed(() => Math.max(0, props.flipp.lives.value))

const overlay = computed(() => {
  const s = props.flipp.status.value
  if (s === 'gameover') return { text: 'GAME OVER', sub: 'TAP TO RESTART', color: 'red' }
  if (s === 'won') return { text: 'LEVEL CLEAR!', sub: '', color: 'yellow' }
  if (s === 'sunk') return { text: 'SPLASH!', sub: '', color: 'cyan' }
  if (s === 'idle' && props.flipp.lives.value === 3 && props.flipp.score.value === 0 && props.flipp.level.value === 1) {
    return { text: '', sub: 'TAP MAP TO DROP MARBLE', color: 'cyan' }
  }
  if (s === 'idle' && props.flipp.lives.value > 0) {
    return { text: '', sub: 'TAP MAP TO CONTINUE', color: 'cyan' }
  }
  return null
})

function onOverlayTap() {
  if (props.flipp.status.value === 'gameover') emit('restart')
}
</script>

<template>
  <div v-if="flipp.active.value" class="flipp-hud">
    <!-- Top bar -->
    <div class="flipp-bar">
      <div class="flipp-cell flipp-cyan">{{ levelStr }}</div>
      <div class="flipp-cell flipp-yellow">{{ scoreStr }}</div>
      <div class="flipp-cell flipp-hearts">
        <svg v-for="i in heartCount" :key="`h-${i}`" viewBox="0 0 9 8" class="flipp-heart">
          <!-- 8-bit heart, 9×8 px -->
          <rect x="1" y="1" width="2" height="1" fill="#ff3b3b"/>
          <rect x="6" y="1" width="2" height="1" fill="#ff3b3b"/>
          <rect x="0" y="2" width="9" height="2" fill="#ff3b3b"/>
          <rect x="1" y="4" width="7" height="1" fill="#ff3b3b"/>
          <rect x="2" y="5" width="5" height="1" fill="#ff3b3b"/>
          <rect x="3" y="6" width="3" height="1" fill="#ff3b3b"/>
          <rect x="4" y="7" width="1" height="1" fill="#ff3b3b"/>
        </svg>
        <svg v-for="i in (3 - heartCount)" :key="`he-${i}`" viewBox="0 0 9 8" class="flipp-heart flipp-heart-empty">
          <rect x="1" y="1" width="2" height="1" fill="#444"/>
          <rect x="6" y="1" width="2" height="1" fill="#444"/>
          <rect x="0" y="2" width="9" height="2" fill="#444"/>
          <rect x="1" y="4" width="7" height="1" fill="#444"/>
          <rect x="2" y="5" width="5" height="1" fill="#444"/>
          <rect x="3" y="6" width="3" height="1" fill="#444"/>
          <rect x="4" y="7" width="1" height="1" fill="#444"/>
        </svg>
      </div>
    </div>

    <!-- Bottom-right: exit-knapp -->
    <button class="flipp-exit" @click="emit('exit')">EXIT</button>

    <!-- Center overlay: GAME OVER / LEVEL CLEAR / TAP TO START -->
    <div v-if="overlay"
         class="flipp-overlay"
         :class="{ 'flipp-tappable': flipp.status.value === 'gameover' }"
         @click="onOverlayTap">
      <div v-if="overlay.text"
           class="flipp-overlay-main"
           :class="`flipp-${overlay.color}`">
        {{ overlay.text }}
      </div>
      <div v-if="overlay.sub"
           class="flipp-overlay-sub"
           :class="`flipp-${overlay.color}`">
        {{ overlay.sub }}
      </div>
    </div>
  </div>
</template>

<style scoped>
@font-face {
  font-family: 'Press Start 2P';
  src: url('../assets/PressStart2P-Regular.woff2') format('woff2');
  font-display: swap;
}

.flipp-hud {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 50;
  font-family: 'Press Start 2P', 'Courier New', monospace;
  -webkit-font-smoothing: none;
  font-smoothing: none;
}

.flipp-bar {
  position: absolute;
  top: 0; left: 0; right: 0;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 12px;
  background: #000;
  font-size: 10px;
  letter-spacing: 0.6px;
  border-bottom: 2px solid #222;
}

.flipp-cell {
  white-space: nowrap;
  display: flex;
  align-items: center;
  gap: 4px;
}

.flipp-hearts {
  gap: 3px;
}

.flipp-heart {
  width: 18px;
  height: 16px;
  image-rendering: pixelated;
}

.flipp-cyan { color: #5cefff; }
.flipp-yellow { color: #ffe24d; }
.flipp-red { color: #ff3b3b; }

.flipp-exit {
  position: absolute;
  bottom: 16px; right: 16px;
  pointer-events: auto;
  background: #000;
  color: #5cefff;
  font-family: inherit;
  font-size: 10px;
  letter-spacing: 0.6px;
  padding: 8px 12px;
  border: 2px solid #5cefff;
  border-radius: 0;
  cursor: pointer;
}
.flipp-exit:active {
  background: #5cefff;
  color: #000;
}

.flipp-overlay {
  position: absolute;
  top: 50%; left: 50%;
  transform: translate(-50%, -50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1.6em;
  padding: 16px;
  text-align: center;
}
.flipp-overlay.flipp-tappable {
  pointer-events: auto;
  cursor: pointer;
}

.flipp-overlay-main {
  font-size: 28px;
  text-shadow: 4px 4px 0 #000;
  animation: flipp-blink 0.6s steps(2, end) infinite;
}

.flipp-overlay-sub {
  font-size: 10px;
  text-shadow: 2px 2px 0 #000;
  animation: flipp-blink 0.9s steps(2, end) infinite;
}

@keyframes flipp-blink {
  0% { opacity: 1; }
  50% { opacity: 0.4; }
  100% { opacity: 1; }
}
</style>
