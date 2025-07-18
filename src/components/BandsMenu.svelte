<script>
  import { fade, scale } from 'svelte/transition';
  import { quintOut } from 'svelte/easing';
  import { eventBus } from '../eventBus';
  import { audio, waterfall } from '../lib/backend.js';
  import { serverInfo } from '../stores/serverInfo.js';
  
  export let showBandsMenu = false;
  
  // Function to convert Maidenhead locator to coordinates
  function maidenheadToCoords(locator) {
    if (!locator || locator.length < 2) return null;
    
    const chars = locator.toUpperCase().split('');
    let lon = (chars[0].charCodeAt(0) - 65) * 20 - 180;
    let lat = (chars[1].charCodeAt(0) - 65) * 10 - 90;
    
    if (locator.length >= 4) {
      lon += (parseInt(chars[2]) * 2);
      lat += parseInt(chars[3]);
    }
    
    return { lat, lon };
  }
  
  // Function to determine ITU region from coordinates
  function getITURegion(lat, lon) {
    // ITU Region 2: Americas
    if (lon >= -170 && lon <= -30) return 2;
    
    // ITU Region 3: Asia-Pacific (simplified)
    if (lon >= 60 && lon <= 170) {
      // Special cases for Region 1 countries in Asia
      if (lat > 30 && lon < 75) return 1; // Middle East
      return 3;
    }
    
    // ITU Region 1: Europe, Africa, Middle East
    return 1;
  }
  
  // Get ITU region from server location
  function getRegionFromLocation() {
    const coords = maidenheadToCoords($serverInfo.location);
    console.log(coords)
    if (!coords) return 1; // Default to Region 1
    return getITURegion(coords.lat, coords.lon);
  }
  
  const ituRegion = getRegionFromLocation();
  console.log("itu" + ituRegion)
  // Amateur bands by ITU region
  const amateurBandsByRegion = {
    1: [ // Europe, Africa, Middle East
      { name: '2200m', start: 135.7, end: 137.8, mode: 'CW' },
      { name: '630m', start: 472, end: 479, mode: 'CW' },
      { name: '160m', start: 1810, end: 2000, mode: 'LSB' },
      { name: '80m', start: 3500, end: 3800, mode: 'LSB' },
      { name: '60m', start: 5351.5, end: 5366.5, mode: 'USB' },
      { name: '40m', start: 7000, end: 7200, mode: 'LSB' },
      { name: '30m', start: 10100, end: 10150, mode: 'CW' },
      { name: '20m', start: 14000, end: 14350, mode: 'USB' },
      { name: '17m', start: 18068, end: 18168, mode: 'USB' },
      { name: '15m', start: 21000, end: 21450, mode: 'USB' },
      { name: '12m', start: 24890, end: 24990, mode: 'USB' },
      { name: '10m', start: 28000, end: 29700, mode: 'USB' },
      { name: '6m', start: 50000, end: 54000, mode: 'USB' },
      { name: '4m', start: 70000, end: 70500, mode: 'USB' },
      { name: '2m', start: 144000, end: 146000, mode: 'USB' },
      { name: '70cm', start: 430000, end: 440000, mode: 'USB' }
    ],
    2: [ // Americas
      { name: '2200m', start: 135.7, end: 137.8, mode: 'CW' },
      { name: '630m', start: 472, end: 479, mode: 'CW' },
      { name: '160m', start: 1800, end: 2000, mode: 'LSB' },
      { name: '80m', start: 3500, end: 4000, mode: 'LSB' },
      { name: '60m', start: 5330.5, end: 5406.4, mode: 'USB' },
      { name: '40m', start: 7000, end: 7300, mode: 'LSB' },
      { name: '30m', start: 10100, end: 10150, mode: 'CW' },
      { name: '20m', start: 14000, end: 14350, mode: 'USB' },
      { name: '17m', start: 18068, end: 18168, mode: 'USB' },
      { name: '15m', start: 21000, end: 21450, mode: 'USB' },
      { name: '12m', start: 24890, end: 24990, mode: 'USB' },
      { name: '10m', start: 28000, end: 29700, mode: 'USB' },
      { name: '6m', start: 50000, end: 54000, mode: 'USB' },
      { name: '2m', start: 144000, end: 148000, mode: 'USB' },
      { name: '1.25m', start: 222000, end: 225000, mode: 'USB' },
      { name: '70cm', start: 420000, end: 450000, mode: 'USB' }
    ],
    3: [ // Asia-Pacific
      { name: '2200m', start: 135.7, end: 137.8, mode: 'CW' },
      { name: '630m', start: 472, end: 479, mode: 'CW' },
      { name: '160m', start: 1800, end: 2000, mode: 'LSB' },
      { name: '80m', start: 3500, end: 3900, mode: 'LSB' },
      { name: '60m', start: 5351.5, end: 5366.5, mode: 'USB' },
      { name: '40m', start: 7000, end: 7200, mode: 'LSB' },
      { name: '30m', start: 10100, end: 10150, mode: 'CW' },
      { name: '20m', start: 14000, end: 14350, mode: 'USB' },
      { name: '17m', start: 18068, end: 18168, mode: 'USB' },
      { name: '15m', start: 21000, end: 21450, mode: 'USB' },
      { name: '12m', start: 24890, end: 24990, mode: 'USB' },
      { name: '10m', start: 28000, end: 29700, mode: 'USB' },
      { name: '6m', start: 50000, end: 54000, mode: 'USB' },
      { name: '2m', start: 144000, end: 146000, mode: 'USB' },
      { name: '70cm', start: 430000, end: 440000, mode: 'USB' }
    ]
  };
  
  const amateurBands = amateurBandsByRegion[ituRegion] || amateurBandsByRegion[1];
  
  // Broadcast bands
  const broadcastBands = [
    { name: 'LW', start: 148.5, end: 283.5, mode: 'AM' },
    { name: 'MW', start: 526.5, end: 1606.5, mode: 'AM' },
    { name: '120m', start: 2300, end: 2495, mode: 'AM' },
    { name: '90m', start: 3200, end: 3400, mode: 'AM' },
    { name: '75m', start: 3900, end: 4000, mode: 'AM' },
    { name: '60m BC', start: 4750, end: 5060, mode: 'AM' },
    { name: '49m', start: 5900, end: 6200, mode: 'AM' },
    { name: '41m', start: 7200, end: 7450, mode: 'AM' },
    { name: '31m', start: 9400, end: 9900, mode: 'AM' },
    { name: '25m', start: 11600, end: 12100, mode: 'AM' },
    { name: '22m', start: 13570, end: 13870, mode: 'AM' },
    { name: '19m', start: 15100, end: 15800, mode: 'AM' },
    { name: '16m', start: 17480, end: 17900, mode: 'AM' },
    { name: '15m BC', start: 18900, end: 19020, mode: 'AM' },
    { name: '13m', start: 21450, end: 21850, mode: 'AM' },
    { name: '11m', start: 25670, end: 26100, mode: 'AM' }
  ];
  
  // Other bands
  const otherBands = [
    { name: 'CB', start: 26965, end: 27405, mode: 'AM' },
    { name: 'ISM 6.78', start: 6765, end: 6795, mode: 'USB' },
    { name: 'ISM 13.56', start: 13553, end: 13567, mode: 'USB' },
    { name: 'ISM 27.12', start: 26957, end: 27283, mode: 'USB' }
  ];

  const customBands = [
    { name: 'Band A', start: 14200, end: 14200, mode: 'USB' },
    { name: 'Band B', start: 7200, end: 7200, mode: 'LSB' }
  ];
  
  let minFreq = 0;
  let maxFreq = 30000; // Default to 30 MHz
  let availableBands = [];
  
  function updateAvailableBands() {
    if (audio && audio.settings) {
      minFreq = audio.settings.basefreq / 1000; // Convert Hz to kHz
      maxFreq = (audio.settings.basefreq + audio.settings.total_bandwidth) / 1000;
    }
    
    // Filter bands that fall within the SDR's frequency range
    const allBands = [...customBands, ...amateurBands, ...broadcastBands, ...otherBands];
    availableBands = allBands.filter(band => 
      (band.start >= minFreq && band.start <= maxFreq) ||
      (band.end >= minFreq && band.end <= maxFreq) ||
      (band.start <= minFreq && band.end >= maxFreq)
    );
  }
  
  function goToBand(band) {
    // Calculate center frequency of the band
    const centerFreq = (band.start + band.end) / 2;
    
    // Convert kHz to Hz
    const frequencyHz = centerFreq * 1000;
    
    // Set frequency and mode
    eventBus.publish('frequencyChange', { detail: frequencyHz });
    eventBus.publish('setMode', band.mode);
    
    // Adjust waterfall to show the entire band
    if (waterfall && audio && audio.settings) {
      const bandwidth = (band.end - band.start) * 1000; // Band width in Hz
      const desiredView = bandwidth * 1.5; // Show 1.5x the band width for context
      
      // Calculate FFT offsets for the band edges with some padding
      const centerFFT = (frequencyHz - audio.settings.basefreq) / audio.settings.total_bandwidth * audio.settings.fft_result_size;
      const viewWidth = Math.min(desiredView / audio.settings.total_bandwidth * audio.settings.fft_result_size, audio.settings.fft_result_size);
      
      const left = Math.max(0, Math.floor(centerFFT - viewWidth / 2));
      const right = Math.min(audio.settings.fft_result_size, Math.ceil(centerFFT + viewWidth / 2));
      
      waterfall.setWaterfallRange(left, right);
    }
    
    // Close menu
    showBandsMenu = false;
  }
  
  function handleKeydown(event) {
    if (event.key === 'Escape' && showBandsMenu) {
      showBandsMenu = false;
    }
  }
  
  // Update available bands when component mounts or when menu is shown
  $: if (showBandsMenu) {
    updateAvailableBands();
  }
</script>

<svelte:window on:keydown={handleKeydown} />

{#if showBandsMenu}
  <div class="modal-container">
    <!-- Backdrop -->
    <div
      class="modal-backdrop"
      on:click={() => showBandsMenu = false}
      transition:fade={{ duration: 150 }}
    ></div>
    
    <!-- Modal -->
    <div
      class="modal-content"
      transition:scale={{ duration: 200, opacity: 0, start: 0.95, easing: quintOut }}
    >
      <!-- Header -->
      <div class="modal-header">
        <h2 class="modal-title">
          <svg class="header-icon" width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z" fill="currentColor"/>
            <path fill-rule="evenodd" d="M4 5a2 2 0 012-2 1 1 0 000 2H6a2 2 0 00-2 2v6a2 2 0 002 2h2a1 1 0 100 2H6a4 4 0 01-4-4V5z" clip-rule="evenodd" fill="currentColor"/>
            <path fill-rule="evenodd" d="M16 5a2 2 0 00-2-2 1 1 0 100 2h0a2 2 0 012 2v6a2 2 0 01-2 2h-2a1 1 0 100 2h2a4 4 0 004-4V5z" clip-rule="evenodd" fill="currentColor"/>
          </svg>
          Band Selection
        </h2>
        <button
          on:click={() => showBandsMenu = false}
          class="close-button"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M13 1L1 13M1 1L13 13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
        </button>
      </div>
      
      <!-- Content -->
      <div class="modal-body">
        <div class="coverage-info">
          SDR Coverage: {minFreq.toFixed(1)} - {maxFreq.toFixed(1)} kHz
        </div>
        
        {#if availableBands.length === 0}
          <p class="empty-state">No bands available in the current SDR range</p>
        {:else}
          <!-- Amateur Bands -->
          {@const amateur = availableBands.filter(b => amateurBands.includes(b))}
          {#if amateur.length > 0}
            <div class="band-section">
              <h3 class="section-label">Amateur Radio</h3>
              <div class="band-grid">
                {#each amateur as band}
                  <button
                    on:click={() => goToBand(band)}
                    class="band-button amateur"
                  >
                    <div class="band-name">{band.name}</div>
                    <div class="band-freq">{band.start} - {band.end}</div>
                    <div class="band-mode">{band.mode}</div>
                  </button>
                {/each}
              </div>
            </div>
          {/if}
          
          <!-- Broadcast Bands -->
          {@const broadcast = availableBands.filter(b => broadcastBands.includes(b))}
          {#if broadcast.length > 0}
            <div class="band-section">
              <h3 class="section-label">Broadcast</h3>
              <div class="band-grid">
                {#each broadcast as band}
                  <button
                    on:click={() => goToBand(band)}
                    class="band-button broadcast"
                  >
                    <div class="band-name">{band.name}</div>
                    <div class="band-freq">{band.start} - {band.end}</div>
                    <div class="band-mode">{band.mode}</div>
                  </button>
                {/each}
              </div>
            </div>
          {/if}
          
          <!-- Other Bands -->
          {@const other = availableBands.filter(b => otherBands.includes(b))}
          {#if other.length > 0}
            <div class="band-section">
              <h3 class="section-label">Other</h3>
              <div class="band-grid">
                {#each other as band}
                  <button
                    on:click={() => goToBand(band)}
                    class="band-button other"
                  >
                    <div class="band-name">{band.name}</div>
                    <div class="band-freq">{band.start} - {band.end}</div>
                    <div class="band-mode">{band.mode}</div>
                  </button>
                {/each}
              </div>
            </div>
          {/if}

          <!-- Custom Bands -->
          {@const custom = availableBands.filter(b => customBands.includes(b))}
          {#if custom.length > 0}
            <div class="band-section">
              <h3 class="section-label">Custom</h3>
              <div class="band-grid">
                {#each custom as band}
                  <button
                    on:click={() => goToBand(band)}
                    class="band-button custom"
                  >
                    <div class="band-name">{band.name}</div>
                    <div class="band-freq">{band.start} - {band.end}</div>
                    <div class="band-mode">{band.mode}</div>
                  </button>
                {/each}
              </div>
            </div>
          {/if}
        {/if}
      </div>
      
      <!-- Footer -->
      <div class="modal-footer">
        <span class="footer-info">ITU Region {ituRegion}</span>
        <button
          on:click={() => showBandsMenu = false}
          class="action-button"
        >
          Done
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  /* Container */
  .modal-container {
    position: fixed;
    inset: 0;
    z-index: 50;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
  }
  
  /* Backdrop */
  .modal-backdrop {
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
  }
  
  /* Modal */
  .modal-content {
    position: relative;
    background: #1c1c1e;
    border-radius: 1rem;
    border: 1px solid rgba(255, 255, 255, 0.08);
    box-shadow: 0 20px 40px rgba(0, 0, 0, 0.5);
    width: 100%;
    max-width: 48rem;
    max-height: 85vh;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
  
  /* Header */
  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1.5rem;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  }
  
  .modal-title {
    font-size: 1.125rem;
    font-weight: 600;
    color: #f5f5f7;
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  
  .header-icon {
    color: #32d74b;
    flex-shrink: 0;
  }
  
  .close-button {
    padding: 0.5rem;
    background: transparent;
    border: none;
    border-radius: 0.5rem;
    color: #a1a1a6;
    cursor: pointer;
    transition: all 0.15s ease;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  
  .close-button:hover {
    background: rgba(255, 255, 255, 0.06);
    color: #f5f5f7;
  }
  
  /* Body */
  .modal-body {
    flex: 1;
    padding: 1.5rem;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
  }
  
  .coverage-info {
    font-size: 0.8125rem;
    color: #a1a1a6;
    margin-bottom: 1.25rem;
    padding: 0.75rem 1rem;
    background: rgba(255, 255, 255, 0.04);
    border-radius: 0.5rem;
    border: 1px solid rgba(255, 255, 255, 0.06);
  }
  
  .empty-state {
    text-align: center;
    color: #6e6e73;
    padding: 3rem;
    font-size: 0.9375rem;
  }
  
  /* Band Sections */
  .band-section {
    margin-bottom: 1.75rem;
  }
  
  .band-section:last-child {
    margin-bottom: 0;
  }
  
  .section-label {
    font-size: 0.75rem;
    font-weight: 600;
    color: #a1a1a6;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: 0.75rem;
  }
  
  .band-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: 0.5rem;
  }
  
  /* Band Buttons */
  .band-button {
    padding: 0.875rem;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 0.625rem;
    cursor: pointer;
    transition: all 0.15s ease;
    text-align: left;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  
  .band-button:hover {
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  }
  
  .band-button.amateur {
    background: rgba(50, 215, 75, 0.08);
    border-color: rgba(50, 215, 75, 0.2);
  }
  
  .band-button.amateur:hover {
    background: rgba(50, 215, 75, 0.12);
    border-color: rgba(50, 215, 75, 0.3);
  }
  
  .band-button.amateur .band-name {
    color: #32d74b;
  }
  
  .band-button.broadcast {
    background: rgba(0, 113, 227, 0.08);
    border-color: rgba(0, 113, 227, 0.2);
  }
  
  .band-button.broadcast:hover {
    background: rgba(0, 113, 227, 0.12);
    border-color: rgba(0, 113, 227, 0.3);
  }
  
  .band-button.broadcast .band-name {
    color: #0071e3;
  }
  
  .band-button.other {
    background: rgba(175, 82, 222, 0.08);
    border-color: rgba(175, 82, 222, 0.2);
  }
  
  .band-button.other:hover {
    background: rgba(175, 82, 222, 0.12);
    border-color: rgba(175, 82, 222, 0.3);
  }
  
  .band-button.other .band-name {
    color: #af52de;
  }
  
  .band-button.custom {
    background: rgba(255, 149, 0, 0.08);
    border-color: rgba(255, 149, 0, 0.2);
  }
  
  .band-button.custom:hover {
    background: rgba(255, 149, 0, 0.12);
    border-color: rgba(255, 149, 0, 0.3);
  }
  
  .band-button.custom .band-name {
    color: #ff9500;
  }
  
  .band-name {
    font-weight: 600;
    font-size: 0.9375rem;
  }
  
  .band-freq {
    font-size: 0.75rem;
    color: #a1a1a6;
  }
  
  .band-mode {
    font-size: 0.6875rem;
    color: #6e6e73;
    font-weight: 500;
  }
  
  /* Footer */
  .modal-footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1.5rem;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
  }
  
  .footer-info {
    font-size: 0.75rem;
    color: #6e6e73;
  }
  
  .action-button {
    padding: 0.5rem 1.25rem;
    background: #0071e3;
    color: white;
    font-weight: 500;
    font-size: 0.875rem;
    border: none;
    border-radius: 0.5rem;
    cursor: pointer;
    transition: background-color 0.15s ease;
  }
  
  .action-button:hover {
    background: #0077ed;
  }
  
  .action-button:active {
    background: #006edb;
  }
  
  /* Responsive */
  @media (max-width: 640px) {
    .modal-content {
      max-height: 90vh;
    }
    
    .band-grid {
      grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
    }
    
    .modal-body {
      padding: 1rem;
    }
  }
  
  /* Scrollbar styling */
  .modal-body::-webkit-scrollbar {
    width: 8px;
  }
  
  .modal-body::-webkit-scrollbar-track {
    background: rgba(255, 255, 255, 0.02);
  }
  
  .modal-body::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.1);
    border-radius: 4px;
  }
  
  .modal-body::-webkit-scrollbar-thumb:hover {
    background: rgba(255, 255, 255, 0.15);
  }
</style>