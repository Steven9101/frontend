<script>
  import { fade } from 'svelte/transition';
  
  // Props
  export let visible = true;
  export let onClick = () => {};
</script>

{#if visible}
  <div
    class="overlay-container"
    id="startaudio"
    on:click={onClick}
    transition:fade={{ duration: 200 }}
  >
    <div class="content-card">
      <div class="icon-container">
        <svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="24" cy="24" r="24" fill="rgba(255, 255, 255, 0.1)"/>
          <path d="M28 16.5v15a1 1 0 01-1.7.7l-6.58-6.58A1 1 0 0019 25H16a2 2 0 01-2-2v-6a2 2 0 012-2h3a1 1 0 00.71-.29L26.3 8.3a1 1 0 011.7.7z" fill="white"/>
          <path d="M31.07 16.93a6 6 0 010 8.49M34.24 13.76a10 10 0 010 14.48" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </div>
      <h2 class="overlay-title">Enable Audio</h2>
      <p class="overlay-text">
        Tap anywhere to start
      </p>
    </div>
  </div>
{/if}

<style>
  /* Container */
  .overlay-container {
    position: absolute;
    inset: 0;
    z-index: 20;
    background: rgba(0, 0, 0, 0.6);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    cursor: pointer;
    display: flex;
    justify-content: center;
    align-items: center;
    transition: opacity 0.2s ease;
  }
  
  /* Content Card */
  .content-card {
    text-align: center;
    padding: 2rem;
    pointer-events: none;
    animation: scaleIn 0.3s ease-out;
  }
  
  /* Icon */
  .icon-container {
    margin: 0 auto 1rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    position: relative;
  }
  
  .icon-container svg {
    filter: drop-shadow(0 4px 12px rgba(0, 0, 0, 0.3));
    animation: pulse 2s ease-in-out infinite;
  }
  
  /* Typography */
  .overlay-title {
    color: white;
    font-size: 1.5rem;
    font-weight: 600;
    margin-bottom: 0.5rem;
    letter-spacing: -0.01em;
    text-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  }
  
  .overlay-text {
    color: rgba(255, 255, 255, 0.9);
    font-size: 1rem;
    font-weight: 400;
    text-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
  }
  
  /* Animations */
  @keyframes scaleIn {
    from {
      transform: scale(0.9);
      opacity: 0;
    }
    to {
      transform: scale(1);
      opacity: 1;
    }
  }
  
  @keyframes pulse {
    0%, 100% {
      transform: scale(1);
      opacity: 1;
    }
    50% {
      transform: scale(1.05);
      opacity: 0.9;
    }
  }
  
  /* Hover effect */
  .overlay-container:hover .icon-container svg {
    transform: scale(1.1);
    transition: transform 0.2s ease;
  }
  
  /* Responsive */
  @media (max-width: 640px) {
    .overlay-title {
      font-size: 1.25rem;
    }
    
    .overlay-text {
      font-size: 0.9375rem;
    }
  }
</style>