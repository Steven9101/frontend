<script>
  import { onMount, onDestroy } from 'svelte';
  import { fade, fly } from 'svelte/transition';
  import { eventBus } from '../eventBus';
  import { waterfall, audio, FFTOffsetToFrequency } from '../lib/backend.js';
  
  let isMobile = false;
  let showZoomSlider = false;
  let zoomPercent = 100; // 100% = no zoom, higher = more zoom
  let showBands = false;
  let showBookmarks = false;
  let isMuted = false; // Track mute state
  let passbandTunerComponent = null; // Reference to passband tuner
  
  function checkMobile() {
    isMobile = window.innerWidth <= 768;
  }
  
  function toggleBands() {
    if (showBands) {
      eventBus.publish('hideBands');
    } else {
      eventBus.publish('showBands');
    }
    showBands = !showBands;
  }
  
  function toggleBookmarks() {
    if (showBookmarks) {
      eventBus.publish('hideBookmarks');
    } else {
      eventBus.publish('showBookmarks');
    }
    showBookmarks = !showBookmarks;
  }
  
  function toggleMute() {
    // Trigger space key event for mute
    const event = new KeyboardEvent('keydown', { key: ' ' });
    window.dispatchEvent(event);
  }
  
  function toggleZoomSlider() {
    showZoomSlider = !showZoomSlider;
    if (showZoomSlider) {
      updateZoomFromWaterfall();
    }
  }
  
  function updateZoomFromWaterfall() {
    // Check if audio is initialized
    if (!audio || !audio.audioMaxSize) {
      zoomPercent = 100;
      return;
    }
    
    // Calculate current zoom percentage based on waterfall range
    const [l, r] = waterfall.getWaterfallRange();
    const fftSize = audio.audioMaxSize;
    const currentWidth = r - l;
    
    // Calculate zoom percentage: 100% = full view, higher = more zoomed in
    // Ensure we don't divide by zero or get invalid values
    if (currentWidth <= 0 || !fftSize || fftSize <= 0) {
      zoomPercent = 100;
      return;
    }
    
    if (currentWidth >= fftSize) {
      zoomPercent = 100;
    } else {
      // Cap the zoom calculation to prevent extreme values
      const rawZoom = (fftSize / currentWidth) * 100;
      zoomPercent = Math.round(Math.min(rawZoom, 100000));
    }
    
    // Ensure zoom is within reasonable bounds and not NaN
    if (isNaN(zoomPercent)) {
      zoomPercent = 100;
    } else {
      zoomPercent = Math.max(100, Math.min(100000, zoomPercent));
    }
  }
  
  function handleZoomChange() {
    // Check if audio is initialized
    if (!audio || !audio.audioMaxSize) {
      console.warn('Audio not initialized');
      return;
    }
    
    // Validate zoom percentage
    if (isNaN(zoomPercent) || zoomPercent < 100 || zoomPercent > 100000) {
      zoomPercent = Math.max(100, Math.min(100000, zoomPercent || 100));
      return;
    }
    
    // Get current audio range to center zoom on audio frequency (like zoom buttons do)
    const [l, m, r] = audio.getAudioRange();
    const audioCenter = m; // Center on the audio frequency
    
    // Get total FFT size
    const fftSize = audio.audioMaxSize;
    
    // Validate FFT size
    if (!fftSize || fftSize <= 0) {
      console.warn('Invalid FFT size:', fftSize);
      return;
    }
    
    // Calculate new width based on zoom percentage
    // zoomPercent = 100 means full bandwidth (no zoom)
    // zoomPercent = 200 means half bandwidth (2x zoom)
    const zoomFactor = zoomPercent / 100;
    const newWidth = Math.round(fftSize / zoomFactor);
    
    // Ensure minimum width to prevent extreme zoom
    const minWidth = Math.max(10, Math.round(fftSize / 1000)); // Max 1000x zoom
    const actualWidth = Math.max(minWidth, newWidth);
    
    // Calculate new bounds centered on audio frequency (like zoom buttons do)
    let newL = Math.round(audioCenter - actualWidth / 2);
    let newR = Math.round(audioCenter + actualWidth / 2);
    
    // Clamp to valid FFT range
    if (newL < 0) {
      const shift = -newL;
      newL = 0;
      newR = Math.min(fftSize, newR + shift);
    }
    if (newR > fftSize) {
      const shift = newR - fftSize;
      newR = fftSize;
      newL = Math.max(0, newL - shift);
    }
    
    // Final validation
    if (newR <= newL || newL < 0 || newR > fftSize) {
      console.warn('Invalid zoom range calculated:', { newL, newR, fftSize });
      return;
    }
    
    // Apply the new range
    waterfall.setWaterfallRange(newL, newR);
    
    // Update passband tuner and display stack (like zoom buttons do)
    if (passbandTunerComponent && typeof passbandTunerComponent.setZoomLevel === 'function') {
      passbandTunerComponent.setZoomLevel(zoomFactor);
    }
    
    // Note: waterfallRangeChanged event is now published automatically by waterfall.setWaterfallRange()
  }
  
  onMount(() => {
    checkMobile();
    window.addEventListener('resize', checkMobile);
    
    // Reset states when dialogs are closed
    eventBus.subscribe('bandsMenuClosed', () => {
      showBands = false;
    });
    
    eventBus.subscribe('bookmarksDialogClosed', () => {
      showBookmarks = false;
    });
    
    // Listen for waterfall range changes to update zoom display
    eventBus.subscribe('waterfallRangeChanged', () => {
      if (showZoomSlider) {
        updateZoomFromWaterfall();
      }
    });
    
    // Listen for mute state changes
    eventBus.subscribe('muteStateChanged', (muted) => {
      isMuted = muted;
    });
    
    // Check initial mute state
    if (audio) {
      isMuted = audio.mute || false;
    }
  });
  
  onDestroy(() => {
    window.removeEventListener('resize', checkMobile);
  });
  
  // Export function to set passband tuner reference
  export function setPassbandTuner(component) {
    passbandTunerComponent = component;
  }
</script>

{#if isMobile}
  <div class="mobile-bottom-bar">
    <!-- Zoom slider popup -->
    {#if showZoomSlider}
      <div 
        class="zoom-slider-popup"
        transition:fly={{ y: 50, duration: 200 }}
      >
        <div class="zoom-slider-container">
          <span class="zoom-label">Zoom</span>
          <input
            type="range"
            min="100"
            max="100000"
            step="100"
            bind:value={zoomPercent}
            on:input={handleZoomChange}
            class="zoom-slider"
          />
          <span class="zoom-value">{(zoomPercent / 100).toFixed(1)}x</span>
        </div>
      </div>
    {/if}
    
    <!-- Bottom bar buttons -->
    <div class="bottom-bar-buttons">
      <button
        class="bar-button {showBands ? 'active' : ''}"
        on:click={toggleBands}
        title="Band Selection"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M3 7H21M3 12H21M3 17H21" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>
        <span class="bar-label">Bands</span>
      </button>
      
      <button
        class="bar-button {showBookmarks ? 'active' : ''}"
        on:click={toggleBookmarks}
        title="Bookmarks"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M19 21L12 16L5 21V5C5 3.89543 5.89543 3 7 3H17C18.1046 3 19 3.89543 19 5V21Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
        </svg>
        <span class="bar-label">Bookmarks</span>
      </button>
      
      <button
        class="bar-button {isMuted ? 'active' : ''}"
        on:click={toggleMute}
        title={isMuted ? 'Unmute' : 'Mute'}
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          {#if isMuted}
            <path d="M11 5L6 9H2V15H6L11 19V5Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
            <path d="M23 9L17 15M17 9L23 15" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          {:else}
            <path d="M11 5L6 9H2V15H6L11 19V5Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
            <path d="M15.54 8.46C16.4738 9.39379 17.0081 10.6692 17.0081 12C17.0081 13.3308 16.4738 14.6062 15.54 15.54M18.07 5.93C19.9447 7.80528 20.9979 10.3576 20.9979 13.005C20.9979 15.6524 19.9447 18.2047 18.07 20.08" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          {/if}
        </svg>
        <span class="bar-label">{isMuted ? 'Unmute' : 'Mute'}</span>
      </button>
      
      <button
        class="bar-button {showZoomSlider ? 'active' : ''}"
        on:click={toggleZoomSlider}
        title="Waterfall Zoom"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="11" cy="11" r="8" stroke="currentColor" stroke-width="2"/>
          <path d="M21 21L16.65 16.65" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          <path d="M11 8V14M8 11H14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>
        <span class="bar-label">Zoom</span>
      </button>
    </div>
  </div>
{/if}

<style>
  .mobile-bottom-bar {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    background: rgba(28, 28, 30, 0.95);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border-top: 1px solid rgba(255, 255, 255, 0.12);
    z-index: 998;
    padding-bottom: env(safe-area-inset-bottom);
  }
  
  .bottom-bar-buttons {
    display: flex;
    justify-content: space-around;
    align-items: center;
    padding: 0.5rem 0;
  }
  
  .bar-button {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.25rem;
    padding: 0.5rem 1rem;
    background: transparent;
    border: none;
    color: #a1a1a6;
    cursor: pointer;
    transition: all 0.15s ease;
    border-radius: 0.5rem;
  }
  
  .bar-button:hover,
  .bar-button:active {
    background: rgba(255, 255, 255, 0.08);
    color: #f5f5f7;
  }
  
  .bar-button.active {
    color: #0071e3;
  }
  
  .bar-label {
    font-size: 0.625rem;
    font-weight: 500;
  }
  
  /* Zoom slider popup */
  .zoom-slider-popup {
    position: absolute;
    bottom: 100%;
    left: 0;
    right: 0;
    background: rgba(28, 28, 30, 0.98);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 0.625rem 0.625rem 0 0;
    padding: 1rem;
    margin: 0 1rem;
  }
  
  .zoom-slider-container {
    display: flex;
    align-items: center;
    gap: 1rem;
  }
  
  .zoom-label {
    font-size: 0.875rem;
    color: #e5e5e7;
    font-weight: 500;
    min-width: 3rem;
  }
  
  .zoom-slider {
    flex: 1;
    -webkit-appearance: none;
    appearance: none;
    height: 4px;
    background: rgba(255, 255, 255, 0.1);
    outline: none;
    border-radius: 2px;
  }
  
  .zoom-slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 20px;
    height: 20px;
    background: #0071e3;
    cursor: pointer;
    border-radius: 50%;
    box-shadow: 0 2px 8px rgba(0, 113, 227, 0.4);
  }
  
  .zoom-slider::-moz-range-thumb {
    width: 20px;
    height: 20px;
    background: #0071e3;
    cursor: pointer;
    border-radius: 50%;
    border: none;
    box-shadow: 0 2px 8px rgba(0, 113, 227, 0.4);
  }
  
  .zoom-value {
    font-size: 0.875rem;
    font-family: 'SF Mono', monospace;
    color: #0071e3;
    min-width: 3rem;
    text-align: right;
  }
</style>