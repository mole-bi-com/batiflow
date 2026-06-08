// Instagram Extraction Script
// This file is loaded at runtime and evaluated in the browser context.
// Keep it simple - no template literals needed.

(function() {
  var currentUrl = window.location.href;
  var author = '';
  var body = '';
  var dateText = '';
  var images = [];
  var comments = [];

  // --- AUTHOR EXTRACTION ---
  // Try URL first
  try {
    var urlObj = new URL(currentUrl);
    var pathParts = urlObj.pathname.split('/').filter(Boolean);
    if (pathParts.length >= 1) {
      var username = pathParts[0];
      var nonUsername = ['p','reel','reels','stories','explore','accounts','saved','tags','search','login','signup','oauth','about','press','help','privacy','terms','settings','direct','notifications','discover'];
      var userRegex = /^[a-zA-Z0-9._]{1,30}$/;
      if (!nonUsername.includes(username) && userRegex.test(username)) {
        author = username;
      }
    }
  } catch(e) {}

  // Fallback: find author from link elements
  if (!author) {
    var links = document.querySelectorAll('a');
    for (var i = 0; i < links.length; i++) {
      var href = links[i].getAttribute('href') || '';
      var text = (links[i].textContent || '').trim();
      if (text.length > 0 && text.length < 30 && href.indexOf('/') === 0) {
        var parts = href.split('/').filter(Boolean);
        if (parts.length >= 1 && parts[0] !== 'p' && parts[0] !== 'reel' && parts[0] !== 'reels') {
          if (text.indexOf(' ') === -1) {
            author = text;
            break;
          }
        }
      }
    }
  }

  // --- BODY / CAPTION EXTRACTION ---
  // Strategy 1: Try JSON-LD structured data
  var jsonld = document.querySelector('script[type="application/ld+json"]');
  if (jsonld) {
    try {
      var parsed = JSON.parse(jsonld.textContent || '{}');
      if (parsed && parsed.caption) {
        body = parsed.caption;
      } else if (parsed && parsed.description) {
        body = parsed.description;
      }
    } catch(e) {}
  }

  // Strategy 2: Look for h1/h2 (Instagram often uses h1 for post caption)
  if (!body || body === 'No content' || body.length < 5) {
    var headings = document.querySelectorAll('h1, h2');
    for (var hi = 0; hi < headings.length; hi++) {
      var hText = (headings[hi].textContent || '').trim();
      if (hText.length > 10 && hText.indexOf('Log in') === -1 && hText.indexOf('Sign up') === -1) {
        body = hText;
        break;
      }
    }
  }

  // Strategy 3: Text nodes inside an article, filtering JSON/script content
  if (!body || body === 'No content' || body.length < 5) {
    var article = document.querySelector('article');
    if (article) {
      var allTexts = [];
      var walker = document.createTreeWalker(article, 4, null, false);
      var node;
      while (node = walker.nextNode()) {
        var txt = node.textContent.trim();
        if (txt.length > 20 && txt.indexOf('Log in') === -1 && txt.indexOf('Sign up') === -1) {
          // Check parent is not script/style
          var p = node.parentElement;
          var skip = false;
          while (p) {
            if (p.tagName === 'SCRIPT' || p.tagName === 'STYLE' || p.tagName === 'NOSCRIPT') { skip = true; break; }
            p = p.parentElement;
          }
          if (!skip) {
            allTexts.push(txt);
          }
        }
      }
      // Filter out JSON-looking text
      for (var ti = 0; ti < allTexts.length; ti++) {
        if (allTexts[ti].charAt(0) !== '{' && allTexts[ti].charAt(0) !== '[' && allTexts[ti].indexOf('require') === -1) {
          body = allTexts[ti];
          break;
        }
      }
    }
  }

  // --- DATE ---
  var timeEl = document.querySelector('time');
  if (timeEl) {
    dateText = timeEl.getAttribute('datetime') || timeEl.textContent || 'Recent';
  }

  // --- IMAGES ---
  var imgElements = document.querySelectorAll('article img');
  imgElements.forEach(function(img) {
    var src = img.getAttribute('src');
    var w = img.clientWidth || parseInt(img.getAttribute('width') || '0');
    if (src && src.indexOf('profile') === -1 && w > 200 && images.indexOf(src) === -1) {
      images.push(src);
    }
  });
  if (images.length === 0) {
    document.querySelectorAll('img').forEach(function(img) {
      var src = img.getAttribute('src');
      var w = img.clientWidth || parseInt(img.getAttribute('width') || '0');
      if (src && w > 300 && src.indexOf('profile') === -1 && images.indexOf(src) === -1) {
        images.push(src);
      }
    });
  }

  // --- COMMENTS ---
  var seenNames = {};
  var commentContainers = document.querySelectorAll('ul li, ul div[role="menuitem"]');
  commentContainers.forEach(function(item) {
    var spans = item.querySelectorAll('span');
    var cAuthor = '';
    var cText = '';
    spans.forEach(function(s, idx) {
      var t = (s.textContent || '').trim();
      if (idx === 0 && t.length > 0 && t.length < 30 && t.indexOf(' ') === -1) {
        if (!seenNames[t]) { seenNames[t] = true; cAuthor = t; }
      } else if (cAuthor && t.length > 3) {
        cText += (cText ? ' ' : '') + t;
      }
    });
    if (cAuthor && cText && cAuthor.toLowerCase() !== author.toLowerCase()) {
      comments.push({ author: cAuthor, text: cText.substring(0, 500) });
    }
  });

  return {
    url: currentUrl,
    author: author || 'Unknown Instagrammer',
    headline: author ? '@' + author.toLowerCase() : 'Unknown',
    dateText: dateText,
    body: body || 'No content',
    images: images,
    comments: comments
  };
})();
