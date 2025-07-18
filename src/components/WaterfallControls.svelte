<script>
  import { onMount, onDestroy } from 'svelte';
  import { waterfall } from '../lib/backend.js';
  import { availableColormaps } from '../lib/colormaps';
  import { eventBus } from '../eventBus';
  
  // Local state
  let currentColormap = "gqrx";
  let alpha = 0.5;
  let brightness = 130;
  let min_waterfall = -30;
  let max_waterfall = 110;
  let autoAdjust = false;
  let spectrumDisplay = false;
  let biggerWaterfall = false;
  let showColormapDropdown = false;
  
  // Initialize colormap from localStorage
  function initializeColormap() {
    const savedColormap = localStorage.getItem('selectedColormap');
    // Check if saved colormap is actually available in the list
    if (savedColormap && availableColormaps.includes(savedColormap)) {
      currentColormap = savedColormap;
    } else {
      // Fallback to default if saved colormap is not available
      currentColormap = "gqrx";
      // Clean up invalid localStorage entry
      if (savedColormap) {
        localStorage.removeItem('selectedColormap');
      }
    }
    waterfall.setColormap(currentColormap);
  }
  
  // Initialize on component mount
  onMount(() => {
    initializeColormap();
    // Set initial states
    waterfall.setSpectrum(spectrumDisplay);
    waterfall.setWaterfallBig(biggerWaterfall);
    // Emit initial spectrum state
    eventBus.publish('spectrumDisplayChange', spectrumDisplay);
    
    // Add click outside listener
    window.addEventListener('click', handleClickOutside);
  });
  
  onDestroy(() => {
    window.removeEventListener('click', handleClickOutside);
  });
  
  function handleWaterfallColormapSelect(colormap) {
    currentColormap = colormap;
    waterfall.setColormap(currentColormap);
    localStorage.setItem('selectedColormap', currentColormap);
    showColormapDropdown = false;
  }
  
  function toggleColormapDropdown() {
    showColormapDropdown = !showColormapDropdown;
  }
  
  // Close dropdown when clicking outside
  function handleClickOutside(event) {
    if (!event.target.closest('.colormap-dropdown-container')) {
      showColormapDropdown = false;
    }
  }
  
  function handleAlphaMove() {
    waterfall.setAlpha(1 - alpha);
  }
  
  function handleBrightnessMove() {
    waterfall.setOffset(brightness);
  }
  
  function handleMinMove() {
    waterfall.setMinOffset(min_waterfall);
  }
  
  function handleMaxMove() {
    waterfall.setMaxOffset(max_waterfall);
  }
  
  function handleAutoAdjust() {
    waterfall.autoAdjust = autoAdjust;
  }
  
  function handleSpectrumChange() {
    waterfall.setSpectrum(spectrumDisplay);
    eventBus.publish('spectrumDisplayChange', spectrumDisplay);
  }
  
  function handleWaterfallSizeChange() {
    waterfall.setWaterfallBig(biggerWaterfall);
  }
</script>

<div class="waterfall-controls">
  <h2 class="section-title">Waterfall Controls</h2>

  <!-- Brightness Controls -->
  <div class="control-group">
    <div class="group-header">
      <div class="accent-dot bg-blue-500"></div>
      <h3 class="group-title">Brightness</h3>
    </div>
    <div id="brightness-controls" class="space-y-4">
      <div class="slider-container">
        <span class="slider-label">Min</span>
        <div class="slider-wrapper">
          <input
            type="range"
            bind:value={min_waterfall}
            min="-100"
            max="255"
            step="1"
            class="slider"
            on:input={handleMinMove}
          />
          <div class="slider-track" style="width: {((min_waterfall + 100) / 355) * 100}%"></div>
        </div>
        <span class="slider-value">{min_waterfall}</span>
      </div>
      <div class="slider-container">
        <span class="slider-label">Max</span>
        <div class="slider-wrapper">
          <input
            type="range"
            bind:value={max_waterfall}
            min="0"
            max="255"
            step="1"
            class="slider"
            on:input={handleMaxMove}
          />
          <div class="slider-track" style="width: {(max_waterfall / 255) * 100}%"></div>
        </div>
        <span class="slider-value">{max_waterfall}</span>
      </div>
    </div>
  </div>

  <!-- Colormap Selection -->
  <div class="control-group">
    <div class="group-header">
      <div class="accent-dot bg-purple-500"></div>
      <h3 class="group-title">Colormap</h3>
    </div>
    <div id="colormap-select" class="colormap-dropdown-container">
      <button
        class="custom-select-trigger"
        on:click|stopPropagation={toggleColormapDropdown}
        aria-expanded={showColormapDropdown}
        aria-haspopup="listbox"
      >
        <span class="select-value">{currentColormap}</span>
        <div class="select-icon" class:rotated={showColormapDropdown}>
          <svg width="12" height="8" viewBox="0 0 12 8" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M1 1.5L6 6.5L11 1.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>
      </button>
      
      {#if showColormapDropdown}
        <div class="custom-dropdown">
          <div class="dropdown-inner">
            {#each availableColormaps as colormap}
              <button
                class="dropdown-option {currentColormap === colormap ? 'active' : ''}"
                on:click|stopPropagation={() => handleWaterfallColormapSelect(colormap)}
              >
                {colormap}
              </button>
            {/each}
          </div>
        </div>
      {/if}
    </div>
  </div>

  <!-- Display Options -->
  <div class="control-group">
    <div class="group-header">
      <div class="accent-dot bg-green-500"></div>
      <h3 class="group-title">Display Options</h3>
    </div>
    <div class="toggle-list">
      <div id="auto-adjust" class="toggle-item-row">
        <span class="toggle-label-row">Auto Adjust</span>
        <label class="toggle">
          <input type="checkbox" bind:checked={autoAdjust} on:change={handleAutoAdjust}>
          <span class="toggle-slider"></span>
        </label>
      </div>
      <div id="spectrum-toggle" class="toggle-item-row">
        <span class="toggle-label-row">Spectrum</span>
        <label class="toggle">
          <input type="checkbox" bind:checked={spectrumDisplay} on:change={handleSpectrumChange}>
          <span class="toggle-slider"></span>
        </label>
      </div>
      <div id="bigger-waterfall" class="toggle-item-row">
        <span class="toggle-label-row">Bigger WF</span>
        <label class="toggle">
          <input type="checkbox" bind:checked={biggerWaterfall} on:change={handleWaterfallSizeChange}>
          <span class="toggle-slider"></span>
        </label>
      </div>
    </div>
  </div>

  <slot name="extra-controls"></slot>
</div>

<style>
  /* Container */
  .waterfall-controls {
    display: flex;
    flex-direction: column;
    align-items: center;
    background: #1c1c1e;
    padding: 1.5rem;
    border-radius: 0 0 0.75rem 0.75rem;
    border: 1px solid rgba(255, 255, 255, 0.08);
    min-width: 340px;
    width: 100%;
  }
  
  @media (min-width: 1024px) {
    .waterfall-controls {
      border-radius: 0 0.75rem 0.75rem 0;
      max-width: 450px;
    }
  }
  
  /* Typography */
  .section-title {
    font-size: 1.375rem;
    font-weight: 600;
    color: #f5f5f7;
    margin-bottom: 1.75rem;
    letter-spacing: -0.01em;
  }
  
  .group-title {
    font-size: 0.875rem;
    font-weight: 500;
    color: #e5e5e7;
  }
  
  /* Control Groups */
  .control-group {
    width: 100%;
    margin-bottom: 1.25rem;
    background: rgba(255, 255, 255, 0.04);
    border-radius: 0.625rem;
    padding: 1rem;
    border: 1px solid rgba(255, 255, 255, 0.06);
  }
  
  .group-header {
    display: flex;
    align-items: center;
    margin-bottom: 1rem;
  }
  
  .accent-dot {
    width: 3px;
    height: 14px;
    border-radius: 1.5px;
    margin-right: 0.5rem;
  }
  
  /* Sliders */
  .slider-container {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }
  
  .slider-label {
    font-size: 0.8125rem;
    color: #a1a1a6;
    width: 2rem;
  }
  
  .slider-value {
    font-size: 0.8125rem;
    font-family: 'SF Mono', monospace;
    color: #e5e5e7;
    width: 2.5rem;
    text-align: right;
  }
  
  .slider-wrapper {
    position: relative;
    flex: 1;
    height: 1.5rem;
    display: flex;
    align-items: center;
  }
  
  .slider {
    -webkit-appearance: none;
    appearance: none;
    width: 100%;
    height: 4px;
    background: rgba(255, 255, 255, 0.1);
    outline: none;
    border-radius: 2px;
    position: relative;
    z-index: 2;
  }
  
  .slider-track {
    position: absolute;
    height: 4px;
    background: #0071e3;
    border-radius: 2px;
    pointer-events: none;
    transition: width 0.1s ease;
  }
  
  .slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 20px;
    height: 20px;
    background: #f5f5f7;
    cursor: pointer;
    border-radius: 50%;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
    transition: all 0.15s ease;
  }
  
  .slider::-moz-range-thumb {
    width: 20px;
    height: 20px;
    background: #f5f5f7;
    cursor: pointer;
    border-radius: 50%;
    border: none;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
    transition: all 0.15s ease;
  }
  
  .slider:hover::-webkit-slider-thumb {
    transform: scale(1.1);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
  }
  
  .slider:hover::-moz-range-thumb {
    transform: scale(1.1);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
  }
  
  /* Custom Dropdown */
  .colormap-dropdown-container {
    position: relative;
    width: 100%;
  }
  
  .custom-select-trigger {
    width: 100%;
    padding: 0.625rem 2.5rem 0.625rem 0.875rem;
    font-size: 0.875rem;
    background: rgba(255, 255, 255, 0.06);
    color: #e5e5e7;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 0.5rem;
    appearance: none;
    cursor: pointer;
    transition: all 0.15s ease;
    outline: none;
    display: flex;
    align-items: center;
    justify-content: space-between;
    text-align: left;
  }
  
  .custom-select-trigger:hover {
    background: rgba(255, 255, 255, 0.08);
    border-color: rgba(255, 255, 255, 0.12);
  }
  
  .custom-select-trigger:focus {
    background: rgba(255, 255, 255, 0.08);
    border-color: #0071e3;
    box-shadow: 0 0 0 3px rgba(0, 113, 227, 0.2);
  }
  
  .select-value {
    flex: 1;
  }
  
  .select-icon {
    position: absolute;
    right: 0.875rem;
    top: 50%;
    transform: translateY(-50%);
    pointer-events: none;
    color: #a1a1a6;
    transition: transform 0.2s ease;
  }
  
  .select-icon.rotated {
    transform: translateY(-50%) rotate(180deg);
  }
  
  .custom-dropdown {
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    margin-top: 0.25rem;
    background: rgba(28, 28, 30, 0.98);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 0.625rem;
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
    z-index: 100;
    overflow: hidden;
    animation: dropdownFadeIn 0.2s ease-out;
  }
  
  .dropdown-inner {
    max-height: 240px;
    overflow-y: auto;
    padding: 0.375rem;
  }
  
  .dropdown-option {
    width: 100%;
    padding: 0.625rem 0.875rem;
    font-size: 0.875rem;
    color: #e5e5e7;
    background: transparent;
    border: none;
    border-radius: 0.375rem;
    cursor: pointer;
    transition: all 0.15s ease;
    text-align: left;
    display: block;
  }
  
  .dropdown-option:hover {
    background: rgba(255, 255, 255, 0.08);
    color: #f5f5f7;
  }
  
  .dropdown-option.active {
    background: rgba(0, 113, 227, 0.2);
    color: #0fb7e6;
    font-weight: 500;
  }
  
  .dropdown-option.active:hover {
    background: rgba(0, 113, 227, 0.3);
  }
  
  @keyframes dropdownFadeIn {
    from {
      opacity: 0;
      transform: translateY(-10px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
  
  /* Custom scrollbar for dropdown */
  .dropdown-inner::-webkit-scrollbar {
    width: 6px;
  }
  
  .dropdown-inner::-webkit-scrollbar-track {
    background: rgba(255, 255, 255, 0.05);
    border-radius: 3px;
  }
  
  .dropdown-inner::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.15);
    border-radius: 3px;
  }
  
  .dropdown-inner::-webkit-scrollbar-thumb:hover {
    background: rgba(255, 255, 255, 0.2);
  }
  
  /* Toggle Switches */
  .toggle-list {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  
  .toggle-item-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.25rem 0;
  }
  
  .toggle-label-row {
    font-size: 0.8125rem;
    color: #e5e5e7;
  }
  
  .toggle {
    position: relative;
    display: inline-block;
    width: 42px;
    height: 26px;
  }
  
  .toggle input {
    opacity: 0;
    width: 0;
    height: 0;
  }
  
  .toggle-slider {
    position: absolute;
    cursor: pointer;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(255, 255, 255, 0.15);
    transition: all 0.2s ease;
    border-radius: 26px;
  }
  
  .toggle-slider:before {
    position: absolute;
    content: "";
    height: 22px;
    width: 22px;
    left: 2px;
    bottom: 2px;
    background: #f5f5f7;
    transition: all 0.2s ease;
    border-radius: 50%;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
  }
  
  .toggle input:checked + .toggle-slider {
    background: #32d74b;
  }
  
  .toggle input:checked + .toggle-slider:before {
    transform: translateX(16px);
  }
  
  .toggle:hover .toggle-slider {
    background: rgba(255, 255, 255, 0.2);
  }
  
  .toggle input:checked:hover + .toggle-slider {
    background: #3ae052;
  }
  
  /* Responsive */
  @media (max-width: 640px) {
    .waterfall-controls {
      padding: 1.25rem;
      min-width: 320px;
    }
    
    .section-title {
      font-size: 1.25rem;
      margin-bottom: 1.5rem;
    }
    
    .control-group {
      padding: 1rem;
      margin-bottom: 1.25rem;
    }
  }
</style>