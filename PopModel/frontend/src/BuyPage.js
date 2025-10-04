import React from 'react';

export default function BuyPage() {
  return (
    <div style={{ padding: 24 }}>
      <h1>Get pop.ai model 2</h1>
      <p>
        Unlock higher quality and better performance with pop.ai model 2 (Claude 3.5 Sonnet).
      </p>
      <ul>
        <li>Best for writing and complex reasoning</li>
        <li>Higher rate limits</li>
        <li>Priority access</li>
      </ul>
      <div style={{ marginTop: 16 }}>
        <a
          className="pm-primary"
          href="#checkout"
          onClick={(e) => { e.preventDefault(); alert('Checkout placeholder. Wire your payment provider here.'); }}
          style={{ padding: '10px 18px', borderRadius: 6, textDecoration: 'none' }}
        >
          Proceed to checkout
        </a>
      </div>
    </div>
  );
}
