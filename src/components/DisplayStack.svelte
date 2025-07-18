<script>
  import { onMount, onDestroy } from 'svelte';
  import PassbandTuner from '../lib/PassbandTuner.svelte';
  import FrequencyInput from '../lib/FrequencyInput.svelte';
  import FrequencyMarkers from '../lib/FrequencyMarkers.svelte';
  import { pinch, pan } from '../lib/hammeractions.js';
  import { waterfall, audio, FFTOffsetToFrequency, frequencyToWaterfallOffset, waterfallOffsetToFrequency } from '../lib/backend.js';
  import { eventBus } from '../eventBus';
  
  // Component references
  export let frequencyInputComponent;
  export let passbandTunerComponent;
  export let frequencyMarkerComponent;
  
  // Canvas references
  let waterfallCanvas;
  let spectrumCanvas;
  let graduationCanvas;
  let bandPlanCanvas;
  let tempCanvas;
  
  // Local state
  let waterfallDragging = false;
  let waterfallDragTotal = 0;
  let waterfallBeginX = 0;
  let spectrumDisplay = false;
  
  // Subscribe to spectrum display changes
  eventBus.subscribe('spectrumDisplayChange', (display) => {
    spectrumDisplay = display;
  });
  
  // Passband update handler
  export function updatePassband(passband) {
    passband = passband || audio.getAudioRange();
    const frequencies = passband.map(FFTOffsetToFrequency);
    const offsets = frequencies.map(frequencyToWaterfallOffset);
    passbandTunerComponent.changePassband(offsets);
  }
  
  // Waterfall event handlers
  function handleWaterfallWheel(e) {
    waterfall.canvasWheel(e);
    passbandTunerComponent.updatePassbandLimits();
    updatePassband();
    frequencyMarkerComponent.updateFrequencyMarkerPositions();
  }
  
  function handleBandPlanClick(event) {
    const rect = event.target.getBoundingClientRect();
    const x = event.clientX - rect.left;
    
    // First, check if a marker was clicked
    const markerClicked = waterfall.handleMarkerClick && waterfall.handleMarkerClick(x);
    
    // If no marker was clicked, handle the passband click
    if (!markerClicked) {
      passbandTunerComponent.handlePassbandClick(event);
    }
  }
  
  function handleBandPlanMouseMove(event) {
    const rect = event.target.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    
    if (waterfall.handleMarkerHover && waterfall.handleMarkerHover(x, y)) {
      event.target.style.cursor = 'pointer';
    } else {
      event.target.style.cursor = 'default';
      waterfall.updateBandPlan(); // Clear previous hover effects
    }
  }
  
  // Dragging handlers
  function handleWaterfallMouseDown(e) {
    waterfallDragTotal = 0;
    waterfallDragging = true;
    waterfallBeginX = e.clientX;
  }
  
  export function handleWindowMouseMove(e) {
    if (waterfallDragging) {
      waterfallDragTotal += Math.abs(e.movementX) + Math.abs(e.movementY);
      waterfall.mouseMove(e);
      updatePassband();
      frequencyMarkerComponent.updateFrequencyMarkerPositions();
    }
  }
  
  export function handleWindowMouseUp(e) {
    if (waterfallDragging) {
      // If mouseup without moving, handle as click
      if (waterfallDragTotal < 2) {
        passbandTunerComponent.handlePassbandClick(e);
      }
      waterfallDragging = false;
    }
  }
  
  // Mobile gesture handlers
  let pinchX = 0;
  function handleWaterfallPinchStart(e) {
    pinchX = 0;
  }
  
  function handleWaterfallPinchMove(e) {
    const diff = e.detail.scale - pinchX;
    pinchX = e.detail.scale;
    const scale = 1 - Math.abs(e.detail.srcEvent.movementX) / waterfallCanvas.getBoundingClientRect().width;
    const evt = e.detail.srcEvent;
    evt.coords = { x: e.detail.center.x };
    evt.deltaY = -Math.sign(diff);
    evt.scaleAmount = scale;
    waterfall.canvasWheel(evt);
    updatePassband();
    // Prevent mouseup event from firing
    waterfallDragTotal += 2;
  }
  
  function handleWaterfallPanMove(e) {
    if (e.detail.srcEvent.pointerType === "touch") {
      waterfall.mouseMove(e.detail.srcEvent);
      updatePassband();
    }
  }
  
  // Passband change handler
  function handlePassbandChange(passband) {
    let [l, m, r] = passband.detail.map(waterfallOffsetToFrequency);
    
    let bfo = frequencyInputComponent.getBFO();
    bfo = 0;
    
    l += bfo;
    m += bfo;
    r += bfo;
    
    // CW offset
    const lOffset = l - 200;
    const mOffset = m - 750;
    const rOffset = r - 200;
    
    eventBus.publish('passbandChange', {
      frequencies: [l, m, r],
      offsets: [lOffset, mOffset, rOffset]
    });
  }
  
  // Frequency marker click handler
  function handleFrequencyMarkerClick(event) {
    eventBus.publish('frequencyMarkerClick', {
      frequency: event.detail.frequency,
      modulation: event.detail.modulation
    });
  }
  
  onMount(() => {
    waterfall.initCanvas({
      canvasElem: waterfallCanvas,
      spectrumCanvasElem: spectrumCanvas,
      graduationCanvasElem: graduationCanvas,
      bandPlanCanvasElem: bandPlanCanvas,
      tempCanvasElem: tempCanvas,
    });
    
    waterfall.setFrequencyMarkerComponent(frequencyMarkerComponent);
  });
</script>

<div class="waterfall-container" id="outer-waterfall-container">
  <div
    class="waterfall-display"
    id="waterfall"
  >
    <canvas
      class="spectrum-canvas {spectrumDisplay ? 'active' : ''}"
      bind:this={spectrumCanvas}
      on:wheel={handleWaterfallWheel}
      on:click={passbandTunerComponent.handlePassbandClick}
      width="1024"
      height="128"
    ></canvas>
    
    <canvas
      class="waterfall-canvas"
      bind:this={waterfallCanvas}
      use:pinch
      on:pinchstart={handleWaterfallPinchStart}
      on:pinchmove={handleWaterfallPinchMove}
      use:pan
      on:panmove={handleWaterfallPanMove}
      on:wheel={handleWaterfallWheel}
      on:mousedown={handleWaterfallMouseDown}
      width="1024"
    ></canvas>
    
    <canvas class="temp-canvas" bind:this={tempCanvas} width="1024" height="1024"></canvas>
    
    <FrequencyInput
      bind:this={frequencyInputComponent}
      on:change
    />
    
    <FrequencyMarkers
      bind:this={frequencyMarkerComponent}
      on:click={passbandTunerComponent.handlePassbandClick}
      on:wheel={handleWaterfallWheel}
      on:markerclick={handleFrequencyMarkerClick}
    />
    
    <canvas
      class="graduation-canvas"
      bind:this={graduationCanvas}
      on:wheel={handleWaterfallWheel}
      on:click={passbandTunerComponent.handlePassbandClick}
      on:mousedown={(e) => passbandTunerComponent.handleMoveStart(e, 1)}
      on:touchstart={passbandTunerComponent.handleTouchStart}
      on:touchmove={passbandTunerComponent.handleTouchMove}
      on:touchend={passbandTunerComponent.handleTouchEnd}
      width="1024"
      height="20"
    ></canvas>
    
    <PassbandTuner
      on:change={handlePassbandChange}
      on:wheel={handleWaterfallWheel}
      bind:this={passbandTunerComponent}
    />
    
    <canvas
      class="band-plan-canvas"
      bind:this={bandPlanCanvas}
      on:wheel={handleWaterfallWheel}
      on:click={handleBandPlanClick}
      on:mousemove={handleBandPlanMouseMove}
      on:mousedown={(e) => passbandTunerComponent.handleMoveStart(e, 1)}
      on:touchstart={passbandTunerComponent.handleTouchStart}
      on:touchmove={passbandTunerComponent.handleTouchMove}
      on:touchend={passbandTunerComponent.handleTouchEnd}
      width="1024"
      height="20"
    />
  </div>
</div>

<style>
  /* Container */
  .waterfall-container {
    width: 100%;
  }
  
  .waterfall-display {
    width: 100%;
    overflow: hidden;
    border-radius: 0.5rem;
    background: #000000;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    image-rendering: pixelated;
    image-rendering: -moz-crisp-edges;
    image-rendering: crisp-edges;
  }
  
  @media (min-width: 1280px) {
    .waterfall-display {
      border-radius: 0.75rem;
    }
  }
  
  /* Canvas Elements */
  .spectrum-canvas,
  .waterfall-canvas,
  .graduation-canvas,
  .band-plan-canvas {
    width: 100%;
    background: #000000;
    display: block;
  }
  
  /* Spectrum Canvas */
  .spectrum-canvas {
    max-height: 0;
    transition: max-height 0.3s ease;
    overflow: hidden;
  }
  
  .spectrum-canvas.active {
    max-height: 10rem;
  }
  
  /* Hidden Canvas */
  .temp-canvas {
    display: none;
  }
  
  /* Graduation Canvas */
  .graduation-canvas {
    border-top: 1px solid rgba(255, 255, 255, 0.1);
    cursor: pointer;
  }
  
  /* Band Plan Canvas */
  .band-plan-canvas {
    border-top: 1px solid rgba(255, 255, 255, 0.1);
    cursor: pointer;
  }
  
  /* Hover Effects */
  .waterfall-canvas {
    cursor: grab;
  }
  
  .waterfall-canvas:active {
    cursor: grabbing;
  }
  
  /* Responsive */
  @media screen and (min-width: 1372px) {
    #outer-waterfall-container {
      min-width: 1372px;
    }
  }
  
  /* Performance optimizations */
  .waterfall-display * {
    -webkit-transform: translateZ(0);
    transform: translateZ(0);
  }
</style>