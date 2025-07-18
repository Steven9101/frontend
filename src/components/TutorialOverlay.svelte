<script>
  import { onMount, tick } from 'svelte';
  import { fade, fly, scale } from 'svelte/transition';
  import { cubicInOut, quintOut } from 'svelte/easing';
  import { serverInfo } from '../stores/serverInfo.js';
  
  // Props
  export let showTutorial = false;
  export let onComplete = () => {};
  
  // Local state
  let currentStep = 0;
  let isFirstTime = false;
  let highlightedElement = null;
  let highlightPosition = { top: 0, left: 0, width: 0, height: 0 };
  let showWelcome = true;
  
  const allTutorialSteps = [
    {
      selector: "#demodulationModes",
      title: "Modulation Modes",
      content: "Select between USB, LSB, CW, AM, or FM modes. The modern interface highlights your active mode with smooth transitions.",
      placement: "bottom"
    },
    {
      selector: "#waterfall",
      title: "Waterfall Display",
      content: "Real-time spectrum visualization with enhanced graphics. Click to tune, drag passband edges, and use mouse wheel to zoom.",
      placement: "top"
    },
    {
      selector: "#volume-slider",
      title: "Volume Control",
      content: "Smooth audio control with visual feedback. The glass-morphism slider shows precise level adjustments.",
      placement: "left"
    },
    {
      selector: "#squelch-slider",
      title: "Squelch Control",
      content: "Intelligent noise suppression with modern slider design. Set threshold to eliminate unwanted background noise.",
      placement: "left"
    },
    {
      selector: "#ft8-decoder",
      title: "FT8 Decoder",
      content: "Built-in digital mode decoder with enhanced display. Automatically decodes FT8 signals on ham bands.",
      placement: "top"
    },
    {
      selector: "#smeter-tut",
      title: "S-Meter & VFO Display",
      content: "Modern frequency display with VFO A/B support (press V to switch), real-time S-meter, and status indicators for NR, NB, AN, and mute.",
      placement: "bottom"
    },
    {
      selector: "#zoom-controls",
      title: "Zoom Controls",
      content: "Glass-morphism zoom buttons for spectrum navigation. Use keyboard shortcuts: +/- for zoom, 0 for max zoom, 9 for full view.",
      placement: "left"
    },
    {
      selector: "#moreoptions",
      title: "Signal Processing",
      content: "Advanced DSP features with visual feedback. Toggle NR (noise reduction), NB (noise blanker), AN (auto notch), and CTCSS filtering.",
      placement: "left"
    },
    {
      selector: "#brightness-controls",
      title: "Display Settings",
      content: "Fine-tune waterfall appearance with modern controls. Adjust brightness and contrast for optimal signal visibility.",
      placement: "top"
    },
    {
      selector: "#colormap-select",
      title: "Color Schemes",
      content: "Professional color palettes optimized for different conditions. Choose from various scientific and aesthetic themes.",
      placement: "top"
    },
    {
      selector: "#auto-adjust",
      title: "Auto Optimization",
      content: "AI-powered display optimization automatically adjusts parameters for best signal visibility.",
      placement: "top"
    },
    {
      selector: "#spectrum-toggle",
      title: "Spectrum Analyzer",
      content: "Toggle the high-resolution spectrum display with modern graphics and smooth animations.",
      placement: "top"
    },
    {
      selector: "#bigger-waterfall",
      title: "Fullscreen Mode",
      content: "Maximize your workspace with expanded waterfall view for professional monitoring.",
      placement: "top"
    },
    {
      selector: "#bands-button",
      title: "Band Selection",
      content: "Quick access to amateur radio bands with automatic ITU region detection. Press G for keyboard shortcut.",
      placement: "left"
    },
    {
      selector: "#bookmark-button",
      title: "Frequency Memory",
      content: "Modern bookmark system with glass-morphism design. Save, organize, and quickly recall your favorite frequencies.",
      placement: "left"
    },
    {
      selector: "#user_count_container",
      title: "Active Users",
      content: "See who's listening with the enhanced user counter featuring modern styling and real-time updates.",
      placement: "top"
    },
    {
      selector: "#chat-box",
      title: "Operator Chat",
      content: "Connect with the SDR community through the integrated chat system with modern UI.",
      placement: "top"
    }
  ];
  
  // Filter out chat step if chat is disabled
  const tutorialSteps = $serverInfo.chatEnabled
    ? allTutorialSteps
    : allTutorialSteps.filter(step => step.selector !== "#chat-box");
  
  async function initTutorial() {
    const allElementsPresent = tutorialSteps.every(step => 
      document.querySelector(step.selector) !== null
    );
    
    if (!allElementsPresent) {
      console.warn("Some tutorial elements are missing. Skipping tutorial.");
      onComplete();
      return;
    }
    
    isFirstTime = localStorage.getItem('phantomSDRTutorialCompleted') === null;
    
    if (isFirstTime && showTutorial) {
      await tick();
      if (tutorialSteps.length > 0) {
        updateHighlight();
      }
    }
  }
  
  async function updateHighlight() {
    if (currentStep >= 0 && currentStep < tutorialSteps.length) {
      const step = tutorialSteps[currentStep];
      highlightedElement = document.querySelector(step.selector);
      
      if (highlightedElement) {
        // Check if element is already mostly visible
        const rect = highlightedElement.getBoundingClientRect();
        const viewportHeight = window.innerHeight;
        const elementTop = rect.top;
        const elementBottom = rect.bottom;
        
        // Only scroll if element is not reasonably visible
        const needsScroll = elementTop < 100 || elementBottom > viewportHeight - 100;
        
        if (needsScroll) {
          highlightedElement.scrollIntoView({
            behavior: 'smooth',
            block: 'nearest',
            inline: 'nearest'
          });
          
          // Wait for scroll to complete
          await new Promise(resolve => setTimeout(resolve, 200));
        }
        
        // Update position after any scrolling
        const finalRect = highlightedElement.getBoundingClientRect();
        highlightPosition = {
          top: finalRect.top - 8,
          left: finalRect.left - 8,
          width: finalRect.width + 16,
          height: finalRect.height + 16
        };
      }
    }
  }
  
  async function nextStep() {
    if (currentStep < tutorialSteps.length - 1) {
      currentStep++;
      await tick();
      updateHighlight();
    } else {
      completeTutorial();
    }
  }
  
  async function previousStep() {
    if (currentStep > 0) {
      currentStep--;
      await tick();
      updateHighlight();
    }
  }
  
  function skipTutorial() {
    completeTutorial();
  }
  
  function completeTutorial() {
    localStorage.setItem('phantomSDRTutorialCompleted', 'true');
    showTutorial = false;
    onComplete();
  }
  
  async function startTutorial() {
    showWelcome = false;
    await tick();
    updateHighlight();
  }
  
  onMount(() => {
    if (showTutorial) {
      initTutorial();
    }
  });
  
  // Optimized resize and scroll handlers
  let ticking = false;
  
  function updatePositionIfNeeded() {
    if (!ticking && showTutorial && !showWelcome && highlightedElement) {
      requestAnimationFrame(() => {
        const rect = highlightedElement.getBoundingClientRect();
        highlightPosition = {
          top: rect.top - 8,
          left: rect.left - 8,
          width: rect.width + 16,
          height: rect.height + 16
        };
        ticking = false;
      });
      ticking = true;
    }
  }
</script>

<svelte:window on:resize={updatePositionIfNeeded} on:scroll={updatePositionIfNeeded} />

{#if showTutorial}
  <!-- Welcome Screen -->
  {#if showWelcome}
    <!-- Simple backdrop -->
    <div 
      class="fixed inset-0 bg-black/50 backdrop-blur-md z-[9998]"
      in:fade={{ duration: 200 }}
      out:fade={{ duration: 150 }}
    />
    
    <div 
      class="fixed inset-0 flex items-center justify-center z-[9999] p-6"
      in:scale={{ duration: 300, easing: quintOut, start: 0.95 }}
      out:fade={{ duration: 150 }}
    >
      <div class="welcome-card">
        <!-- Card content -->
        <div class="relative bg-neutral-900/80 backdrop-blur-xl rounded-2xl p-8 border border-white/10 shadow-2xl">
          <!-- Logo area -->
          <div class="flex justify-center mb-6">
            <div class="w-20 h-20 bg-gradient-to-br from-blue-500 to-blue-600 rounded-2xl flex items-center justify-center shadow-lg">
              <span class="text-white text-3xl font-semibold">PS</span>
            </div>
          </div>
          
          <div class="text-center mb-6">
            <h1 class="text-3xl font-semibold mb-2 text-white">
              PhantomSDR+ 2.0.0
            </h1>
            <p class="text-base text-neutral-400">Next generation web-based SDR</p>
          </div>
          
          <div class="space-y-3 mb-6">
            <div class="feature-item">
              <div class="w-1 h-1 bg-blue-500 rounded-full"></div>
              <p class="text-sm text-neutral-300">VFO A/B switching with keyboard shortcuts (press V)</p>
            </div>
            <div class="feature-item">
              <div class="w-1 h-1 bg-green-500 rounded-full"></div>
              <p class="text-sm text-neutral-300">Advanced signal processing: NR, NB, AN, and CTCSS</p>
            </div>
            <div class="feature-item">
              <div class="w-1 h-1 bg-purple-500 rounded-full"></div>
              <p class="text-sm text-neutral-300">Band selection with automatic ITU region detection</p>
            </div>
            <div class="feature-item">
              <div class="w-1 h-1 bg-orange-500 rounded-full"></div>
              <p class="text-sm text-neutral-300">Modern interface with smooth animations</p>
            </div>
          </div>
          
          <div class="flex gap-3">
            <button
              on:click={startTutorial}
              class="primary-button"
            >
              Start Tutorial
            </button>
            <button
              on:click={skipTutorial}
              class="secondary-button"
            >
              Skip
            </button>
          </div>
        </div>
      </div>
    </div>
  {/if}
  
  <!-- Tutorial Spotlight Effect -->
  {#if !showWelcome}
    <!-- Optimized spotlight backdrop -->
    <div class="fixed inset-0 z-[9998] pointer-events-none">
      <svg class="w-full h-full">
        <defs>
          <mask id="spotlight-mask">
            <rect x="0" y="0" width="100%" height="100%" fill="white" />
            {#if highlightedElement}
              <rect
                x={highlightPosition.left}
                y={highlightPosition.top}
                width={highlightPosition.width}
                height={highlightPosition.height}
                rx="12"
                fill="black"
              />
            {/if}
          </mask>
        </defs>
        <rect
          x="0"
          y="0"
          width="100%"
          height="100%"
          fill="rgba(0,0,0,0.75)"
          mask="url(#spotlight-mask)"
          class="pointer-events-auto"
        />
      </svg>
    </div>
    
    <!-- Highlight Border -->
    {#if highlightedElement}
      <div
        class="fixed pointer-events-none z-[9999] transition-all duration-200 ease-out"
        style="
          top: {highlightPosition.top}px;
          left: {highlightPosition.left}px;
          width: {highlightPosition.width}px;
          height: {highlightPosition.height}px;
        "
      >
        <!-- Simple border -->
        <div class="absolute inset-0 border-2 border-blue-500 rounded-xl"></div>
      </div>
    {/if}
  {/if}
{/if}

<!-- Tutorial Tooltip -->
{#if showTutorial && !showWelcome && highlightedElement && currentStep < tutorialSteps.length}
  <div
    class="tooltip-container"
    in:fly={{ y: 20, duration: 200, easing: quintOut }}
  >
    <div class="tooltip-card">
      <!-- Card content -->
      <div class="relative bg-neutral-900/90 backdrop-blur-xl rounded-xl p-5 border border-white/10 shadow-xl">
        <!-- Progress indicator -->
        <div class="flex items-center justify-between mb-3">
          <div class="flex items-center gap-1.5">
            {#each tutorialSteps as _, i}
              <div
                class="transition-all duration-200 rounded-full
                       {i === currentStep ? 'w-6 h-1.5 bg-blue-500' :
                        i < currentStep ? 'w-1.5 h-1.5 bg-blue-500/40' : 'w-1.5 h-1.5 bg-neutral-600'}"
              />
            {/each}
          </div>
          <span class="text-xs text-neutral-500">
            {currentStep + 1} / {tutorialSteps.length}
          </span>
        </div>
        
        <h3 class="text-base font-medium text-white mb-1.5">
          {tutorialSteps[currentStep].title}
        </h3>
        <p class="text-sm text-neutral-400 mb-4 leading-relaxed">
          {tutorialSteps[currentStep].content}
        </p>
        
        <div class="flex gap-2">
          {#if currentStep > 0}
            <button
              on:click={previousStep}
              class="secondary-button-small"
            >
              Previous
            </button>
          {/if}
          
          <button
            on:click={nextStep}
            class="primary-button-small flex-1"
          >
            {currentStep === tutorialSteps.length - 1 ? 'Finish' : 'Next'}
          </button>
          
          <button
            on:click={skipTutorial}
            class="text-sm text-neutral-500 hover:text-neutral-300 px-3 transition-colors duration-150"
          >
            Skip
          </button>
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  /* Optimized transitions */
  * {
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }
  
  /* Welcome card */
  .welcome-card {
    position: relative;
    max-width: 32rem;
    width: 100%;
  }
  
  /* Feature items */
  .feature-item {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }
  
  /* Buttons - Apple-inspired design */
  .primary-button {
    flex: 1;
    padding: 0.75rem 1.5rem;
    border-radius: 0.625rem;
    font-weight: 500;
    font-size: 0.9375rem;
    color: white;
    background: #0071e3;
    transition: background-color 0.15s ease;
    will-change: background-color;
  }
  
  .primary-button:hover {
    background: #0077ed;
  }
  
  .primary-button:active {
    background: #006edb;
  }
  
  .secondary-button {
    padding: 0.75rem 1.5rem;
    border-radius: 0.625rem;
    font-weight: 500;
    font-size: 0.9375rem;
    color: #e5e5e7;
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.12);
    transition: all 0.15s ease;
  }
  
  .secondary-button:hover {
    background: rgba(255, 255, 255, 0.12);
    border-color: rgba(255, 255, 255, 0.16);
  }
  
  .secondary-button:active {
    background: rgba(255, 255, 255, 0.16);
  }
  
  /* Small buttons for tooltip */
  .primary-button-small {
    padding: 0.5rem 1rem;
    border-radius: 0.5rem;
    font-weight: 500;
    font-size: 0.875rem;
    color: white;
    background: #0071e3;
    transition: background-color 0.15s ease;
  }
  
  .primary-button-small:hover {
    background: #0077ed;
  }
  
  .primary-button-small:active {
    background: #006edb;
  }
  
  .secondary-button-small {
    padding: 0.5rem 1rem;
    border-radius: 0.5rem;
    font-weight: 500;
    font-size: 0.875rem;
    color: #e5e5e7;
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.12);
    transition: all 0.15s ease;
  }
  
  .secondary-button-small:hover {
    background: rgba(255, 255, 255, 0.12);
    border-color: rgba(255, 255, 255, 0.16);
  }
  
  /* Tooltip container */
  .tooltip-container {
    position: fixed !important;
    bottom: 2.5rem !important;
    left: 50% !important;
    transform: translateX(-50%) !important;
    z-index: 10000 !important;
    width: 22rem !important;
    pointer-events: auto;
  }
  
  .tooltip-card {
    position: relative;
  }
  
  /* Performance optimizations */
  @media (prefers-reduced-motion: reduce) {
    * {
      animation-duration: 0.01ms !important;
      animation-iteration-count: 1 !important;
      transition-duration: 0.01ms !important;
    }
  }
  
  /* Hardware acceleration for mobile */
  .transition-all {
    transform: translateZ(0);
    -webkit-transform: translateZ(0);
  }
  
  /* Responsive adjustments */
  @media (max-width: 640px) {
    .tooltip-container {
      width: calc(100vw - 2rem) !important;
      max-width: 22rem !important;
    }
    
    .welcome-card {
      max-width: calc(100vw - 3rem);
    }
  }
</style>