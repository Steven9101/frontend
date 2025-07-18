<script>
  export let version = "2.0.0";
</script>

<footer class="footer">
  <div class="footer-content">
    <span class="footer-text">
      <span class="product-name">PhantomSDR+</span>
      <span class="separator">•</span>
      <span class="version">v{version}</span>
    </span>
  </div>
</footer>

<style>
  /* Container */
  .footer {
    margin-top: 1rem;
    padding-bottom: 1rem;
    text-align: center;
  }
  
  /* Content */
  .footer-content {
    display: inline-flex;
    align-items: center;
    padding: 0.5rem 1rem;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 9999px;
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
  }
  
  /* Text */
  .footer-text {
    font-size: 0.75rem;
    color: #6e6e73;
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  
  .product-name {
    font-weight: 500;
    color: #a1a1a6;
  }
  
  .separator {
    color: #48484a;
  }
  
  .version {
    font-family: 'SF Mono', monospace;
    font-size: 0.7rem;
    color: #6e6e73;
  }
  
  /* Hover effect */
  .footer-content:hover {
    background: rgba(255, 255, 255, 0.06);
    border-color: rgba(255, 255, 255, 0.08);
    transition: all 0.2s ease;
  }
  
  .footer-content:hover .product-name {
    color: #e5e5e7;
  }
  
  .footer-content:hover .version {
    color: #a1a1a6;
  }
</style>