<script lang="ts">
  import '../app.css';
  import { page } from '$app/state';
  let {data,children}=$props();
  const nav=[['/contribute','Contribute'],['/experiments','Research'],['/community','Community'],['/methods','Methods']];
</script>
<svelte:head><meta name="theme-color" content="#193f35"/></svelte:head>
<a class="skip" href="#main" tabindex="0">Skip to content</a>
<div class="topline"><span>Testing search methods on known messages.</span><a href="/status"><span class="dot"></span>{data.stage==='production'?'Operating status':'Development preview · release checks in progress'}</a></div>
<header class="site-header">
  <a class="brand" href="/" aria-label="Voynich at home"><span class="brand-mark" aria-hidden="true">v<span>•</span></span>Voynich<span class="brand-at">@home</span></a>
  <nav aria-label="Main navigation">{#each nav as [url,label]}<a href={url} aria-current={page.url.pathname.startsWith(url)?'page':undefined}>{label}</a>{/each}</nav>
  <a class="account-link" href="/account">{data.user?'My account':data.providers.length?'Sign in':'Account preview'}</a>
</header>
<main id="main" tabindex="-1">{@render children()}</main>
<footer><div><a class="footer-brand" href="/">Voynich@home</a><p>A shared search for testable explanations.</p></div><nav aria-label="Footer"><a href="/verify">Verify a result</a><a href="/downloads">Build & contribute</a><a href="/privacy">Privacy</a><a href="https://github.com/javidmardanov/VoynichAtHome">GitHub ↗</a>{#if data.owner}<a href="/owner">Owner controls</a>{/if}</nav><p class="footer-note">Current research: the development panel is complete, and the fresh-case evaluation is in progress. No manuscript campaign is open.</p></footer>
