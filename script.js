(function () {
  "use strict";

  var navToggle = document.querySelector(".nav__toggle");
  var navMenu = document.querySelector(".nav__menu");
  var yearEl = document.getElementById("year");
  var siteHead = document.querySelector(".site-head");
  var form = document.getElementById("form-contato");
  var turnstileWidget = document.querySelector(".cf-turnstile");
  var captchaRow = document.getElementById("captcha-row");
  var formFeedbackEl = document.getElementById("form-feedback");
  var contactEmail = "071estruturas@gmail.com";
  var contactSubject = "Contato site 071 Estruturas";
  // Troque pela URL publicada do seu Cloudflare Worker.
  var contactEndpoint = "https://YOUR_WORKER_SUBDOMAIN.workers.dev";

  function setFormFeedback(kind, message) {
    if (!formFeedbackEl) return;
    formFeedbackEl.textContent = String(message || "");
    formFeedbackEl.classList.remove("form-feedback--error", "form-feedback--success");
    if (kind === "error") formFeedbackEl.classList.add("form-feedback--error");
    if (kind === "success") formFeedbackEl.classList.add("form-feedback--success");
  }

  function getTurnstileToken() {
    if (!form) return "";
    var input = form.querySelector('input[name="cf-turnstile-response"]');
    return String((input && input.value) || "").trim();
  }

  function getBrazilianDocumentType(digits) {
    if (/^\d{11}$/.test(digits)) return "CPF";
    if (/^\d{14}$/.test(digits)) return "CNPJ";
    return "";
  }

  /**
   * CPF com 11 digitos: valida digitos verificadores (modulo 11).
   * Rejeita sequencias conhecidamente invalidas (todos os digitos iguais).
   */
  function isValidCpfDigits(digits) {
    if (!/^\d{11}$/.test(digits)) return false;
    if (/^(\d)\1{10}$/.test(digits)) return false;
    var sum = 0;
    var i;
    var mod;
    for (i = 0; i < 9; i++) {
      sum += parseInt(digits.charAt(i), 10) * (10 - i);
    }
    mod = sum % 11;
    var dv1 = mod < 2 ? 0 : 11 - mod;
    if (dv1 !== parseInt(digits.charAt(9), 10)) return false;
    sum = 0;
    for (i = 0; i < 10; i++) {
      sum += parseInt(digits.charAt(i), 10) * (11 - i);
    }
    mod = sum % 11;
    var dv2 = mod < 2 ? 0 : 11 - mod;
    return dv2 === parseInt(digits.charAt(10), 10);
  }

  /**
   * Converte digitos Unicode (ex.: largura total, arabicos) para 0-9 antes de contar.
   * Sem isso, replace(/\\D/g) apaga esses caracteres e o CPF parece ter menos de 11 digitos.
   */
  function normalizeBrazilianDocumentDigits(raw) {
    var s = String(raw || "");
    var out = "";
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c >= 0x30 && c <= 0x39) {
        out += s.charAt(i);
      } else if (c >= 0xff10 && c <= 0xff19) {
        out += String.fromCharCode(c - 0xff10 + 0x30);
      } else if (c >= 0x0660 && c <= 0x0669) {
        out += String.fromCharCode(c - 0x0660 + 0x30);
      } else if (c >= 0x06f0 && c <= 0x06f9) {
        out += String.fromCharCode(c - 0x06f0 + 0x30);
      }
    }
    return out;
  }

  /** Tenta .jpg/.jpeg e 01 → 1 para miniaturas e lightbox do portfólio. */
  function portfolioImageUrlVariants(primary) {
    var urls = [primary];
    if (!primary) return urls;
    var lower = primary.toLowerCase();
    if (lower.endsWith(".jpeg")) {
      urls.push(primary.slice(0, -5) + ".jpg");
    } else if (lower.endsWith(".jpg")) {
      urls.push(primary.slice(0, -4) + ".jpeg");
    }
    var m = primary.match(/^(.*\/)(0+)(\d+)\.(jpe?g)$/i);
    if (m && m[3]) {
      urls.push(m[1] + String(parseInt(m[3], 10)) + "." + m[4]);
    }
    return urls.filter(function (u, idx, arr) {
      return arr.indexOf(u) === idx;
    });
  }

  function portfolioUrlDirname(url) {
    var clean = String(url || "");
    var idx = clean.lastIndexOf("/");
    if (idx < 0) return "";
    return clean.slice(0, idx + 1);
  }

  function portfolioBasenameNum(url) {
    var base = String(url || "")
      .split("/")
      .pop()
      .split("?")[0];
    var m = base.match(/^(\d+)\.(jpe?g)$/i);
    return m ? parseInt(m[1], 10) : null;
  }

  /** Carrega a primeira URL da lista que existir (onload). */
  function portfolioFirstLoadableUrl(variants) {
    return new Promise(function (resolve) {
      var list = variants.slice();
      function next() {
        if (!list.length) {
          resolve(null);
          return;
        }
        var u = list.shift();
        var img = new Image();
        img.onload = function () {
          resolve(u);
        };
        img.onerror = function () {
          next();
        };
        img.src = u;
      }
      next();
    });
  }

  /**
   * Completa a lista de fotos do album: mantem as URLs do HTML e adiciona
   * 04.jpeg, 05.jpeg, ... apos o maior numero ja listado, ate 3 falhas seguidas.
   * (Navegador nao lista pasta; so dá para sondar nomes previsiveis.)
   */
  function discoverExtraPortfolioUrls(initialUrls) {
    var urls = (initialUrls || []).map(function (p) {
      return String(p || "").trim();
    }).filter(Boolean);
    if (!urls.length) {
      return Promise.resolve([]);
    }

    var nums = [];
    urls.forEach(function (u) {
      var n = portfolioBasenameNum(u);
      if (n !== null) nums.push(n);
    });
    var maxN = nums.length ? Math.max.apply(null, nums) : 0;
    if (maxN === 0) {
      return Promise.resolve(urls.slice());
    }

    var folder = portfolioUrlDirname(urls[0]);
    var firstBase = urls[0]
      .split("/")
      .pop()
      .split("?")[0];
    var extM = firstBase.match(/(\.(jpe?g))$/i);
    var ext = extM ? extM[1].toLowerCase() : ".jpeg";

    var found = urls.slice();
    var seen = {};
    found.forEach(function (u) {
      seen[u] = true;
    });

    function padNum(n) {
      if (n < 10) return "0" + n;
      return String(Math.min(n, 999));
    }

    return new Promise(function (resolve) {
      var n = maxN + 1;
      var failStreak = 0;

      function finish() {
        found.sort(function (a, b) {
          var na = portfolioBasenameNum(a);
          var nb = portfolioBasenameNum(b);
          if (na !== null && nb !== null) return na - nb;
          if (na === null && nb === null) return 0;
          return na === null ? -1 : 1;
        });
        var out = [];
        found.forEach(function (u) {
          if (out.indexOf(u) < 0) out.push(u);
        });
        resolve(out);
      }

      function step() {
        if (n > maxN + 80 || failStreak >= 3) {
          finish();
          return;
        }
        var candidate = folder + padNum(n) + ext;
        portfolioFirstLoadableUrl(portfolioImageUrlVariants(candidate)).then(function (ok) {
          if (ok && !seen[ok]) {
            seen[ok] = true;
            found.push(ok);
            failStreak = 0;
          } else {
            failStreak++;
          }
          n++;
          step();
        });
      }

      step();
    });
  }

  if (yearEl) {
    yearEl.textContent = String(new Date().getFullYear());
  }

  function setMenuOpen(open) {
    if (!navToggle || !navMenu) return;
    navToggle.setAttribute("aria-expanded", open ? "true" : "false");
    navMenu.classList.toggle("is-open", open);
    document.body.style.overflow = open ? "hidden" : "";
  }

  if (navToggle && navMenu) {
    navToggle.addEventListener("click", function () {
      var expanded = navToggle.getAttribute("aria-expanded") === "true";
      setMenuOpen(!expanded);
    });

    navMenu.querySelectorAll("a").forEach(function (link) {
      link.addEventListener("click", function () {
        setMenuOpen(false);
      });
    });

    window.addEventListener("resize", function () {
      if (window.matchMedia("(min-width: 960px)").matches) {
        setMenuOpen(false);
      }
    });
  }

  if (siteHead) {
    window.addEventListener(
      "scroll",
      function () {
        siteHead.classList.toggle("site-head--scrolled", window.scrollY > 8);
      },
      { passive: true }
    );
  }

  (function initNavScrollSpy() {
    if (!navMenu) return;
    var sectionIds = ["portfolio", "servicos", "cenografia", "quem-somos", "contatos"];

    function headerActivationOffset() {
      return (siteHead ? siteHead.offsetHeight : 72) + 12;
    }

    function updateNavCurrentSection() {
      var y = headerActivationOffset();
      var activeId = null;
      for (var i = sectionIds.length - 1; i >= 0; i--) {
        var id = sectionIds[i];
        var el = document.getElementById(id);
        if (!el) continue;
        if (el.getBoundingClientRect().top <= y) {
          activeId = id;
          break;
        }
      }

      navMenu.querySelectorAll("a").forEach(function (a) {
        a.classList.remove("nav__link--current");
        a.removeAttribute("aria-current");
      });

      if (!activeId) return;

      var ariaDone = false;
      navMenu.querySelectorAll('a[href="#' + activeId + '"]').forEach(function (a) {
        a.classList.add("nav__link--current");
        if (!ariaDone) {
          a.setAttribute("aria-current", "page");
          ariaDone = true;
        }
      });
    }

    updateNavCurrentSection();
    window.addEventListener("scroll", updateNavCurrentSection, { passive: true });
    window.addEventListener("resize", updateNavCurrentSection);
  })();

  document.querySelectorAll('a[href="#topo"]').forEach(function (link) {
    link.addEventListener("click", function (e) {
      e.preventDefault();
      setMenuOpen(false);
      window.scrollTo({ top: 0, behavior: "smooth" });
      if (history.replaceState) {
        history.replaceState(null, "", "#topo");
      }
    });
  });

  (function initBannerImageFallbacks() {
    var bannerImgs = document.querySelectorAll(".hero-banner-media img[data-fallback-srcs]");
    if (!bannerImgs.length) return;

    bannerImgs.forEach(function (img) {
      var fallbackRaw = String(img.getAttribute("data-fallback-srcs") || "");
      var fallbacks = fallbackRaw
        .split(",")
        .map(function (src) {
          return src.trim();
        })
        .filter(Boolean);

      if (!fallbacks.length) return;

      var queue = fallbacks.slice();
      var current = String(img.getAttribute("src") || "").trim();
      if (current) {
        queue.unshift(current);
      }

      var next = queue.shift();
      if (next) {
        img.src = next;
      }

      img.addEventListener("error", function handleImageError() {
        if (!queue.length) {
          img.removeEventListener("error", handleImageError);
          return;
        }
        img.src = queue.shift();
      });
    });
  })();

  (function initPortfolioThumbFallbacks() {
    var thumbs = document.querySelectorAll("#portfolio-grid .segment__photo");
    if (!thumbs.length) return;

    thumbs.forEach(function (img) {
      var primary = String(img.getAttribute("src") || "").trim();
      if (!primary) return;
      var queue = portfolioImageUrlVariants(primary).slice(1);
      if (!queue.length) return;

      img.addEventListener("error", function onThumbErr() {
        if (!queue.length) {
          img.removeEventListener("error", onThumbErr);
          return;
        }
        img.src = queue.shift();
      });
    });
  })();

  (function initHeroCarousel() {
    var root = document.getElementById("hero-carousel");
    if (!root) return;

    var viewport = root.querySelector(".hero-carousel__viewport");
    var track = root.querySelector(".hero-carousel__track");
    var slides = root.querySelectorAll(".hero-carousel__slide");
    var prevBtn = root.querySelector(".hero-carousel__arrow--prev");
    var nextBtn = root.querySelector(".hero-carousel__arrow--next");
    var dotsContainer = root.querySelector(".hero-carousel__dots");
    var n = slides.length;
    var i = 0;

    if (n < 2) {
      if (prevBtn && prevBtn.parentElement) {
        prevBtn.parentElement.style.display = "none";
      }
      if (dotsContainer) {
        dotsContainer.style.display = "none";
      }
      return;
    }
    var autoplayMs = parseInt(String(root.getAttribute("data-autoplay-ms") || ""), 10) || 6500;
    var timer = null;
    var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reduced) {
      root.classList.add("hero-carousel--instant");
    }

    function buildDots() {
      if (!dotsContainer) return;
      dotsContainer.innerHTML = "";
      for (var d = 0; d < n; d++) {
        var b = document.createElement("button");
        b.type = "button";
        b.className = "hero-carousel__dot";
        b.setAttribute("role", "tab");
        b.setAttribute("aria-label", "Banner " + (d + 1) + " de " + n);
        b.setAttribute("aria-selected", d === 0 ? "true" : "false");
        b.setAttribute("tabindex", d === 0 ? "0" : "-1");
        (function (idx) {
          b.addEventListener("click", function () {
            go(idx, true);
          });
        })(d);
        dotsContainer.appendChild(b);
      }
    }

    function getDots() {
      return dotsContainer ? dotsContainer.querySelectorAll(".hero-carousel__dot") : [];
    }

    function setAria() {
      slides.forEach(function (slide, idx) {
        slide.setAttribute("aria-hidden", idx !== i ? "true" : "false");
      });
      Array.prototype.forEach.call(getDots(), function (dot, idx) {
        dot.setAttribute("aria-selected", idx === i ? "true" : "false");
        dot.setAttribute("tabindex", idx === i ? "0" : "-1");
      });
    }

    function layout() {
      if (!viewport || !track) return;
      var w = viewport.offsetWidth;
      if (w <= 0) return;
      slides.forEach(function (slide) {
        slide.style.flexBasis = w + "px";
        slide.style.width = w + "px";
        slide.style.maxWidth = w + "px";
      });
      track.style.transform = "translate3d(" + -i * w + "px,0,0)";
    }

    function go(idx, userInitiated) {
      i = ((idx % n) + n) % n;
      layout();
      setAria();
      if (userInitiated) {
        restartAutoplay();
      }
    }

    function startAutoplay() {
      if (reduced || autoplayMs < 800) return;
      stopAutoplay();
      timer = window.setInterval(function () {
        go(i + 1, false);
      }, autoplayMs);
    }

    function stopAutoplay() {
      if (timer !== null) {
        window.clearInterval(timer);
        timer = null;
      }
    }

    function restartAutoplay() {
      stopAutoplay();
      startAutoplay();
    }

    if (prevBtn) {
      prevBtn.addEventListener("click", function () {
        go(i - 1, true);
      });
    }
    if (nextBtn) {
      nextBtn.addEventListener("click", function () {
        go(i + 1, true);
      });
    }

    root.addEventListener("mouseenter", stopAutoplay);
    root.addEventListener("mouseleave", startAutoplay);
    root.addEventListener("focusin", stopAutoplay);
    root.addEventListener("focusout", function (e) {
      if (!root.contains(e.relatedTarget)) {
        startAutoplay();
      }
    });

    document.addEventListener("visibilitychange", function () {
      if (document.hidden) {
        stopAutoplay();
      } else {
        startAutoplay();
      }
    });

    var touchStartX = 0;
    if (viewport) {
      viewport.addEventListener(
        "touchstart",
        function (e) {
          touchStartX = e.changedTouches[0].screenX;
        },
        { passive: true }
      );
      viewport.addEventListener(
        "touchend",
        function (e) {
          var dx = e.changedTouches[0].screenX - touchStartX;
          if (Math.abs(dx) > 45) {
            if (dx < 0) {
              go(i + 1, true);
            } else {
              go(i - 1, true);
            }
          }
        },
        { passive: true }
      );
    }

    root.addEventListener("keydown", function (e) {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        go(i - 1, true);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        go(i + 1, true);
      }
    });

    buildDots();
    setAria();

    function layoutSoon() {
      layout();
      window.requestAnimationFrame(function () {
        layout();
      });
    }

    layoutSoon();
    window.addEventListener("resize", layoutSoon);

    if (!reduced) {
      startAutoplay();
    }
  })();

  (function initPortfolioLightbox() {
    var lightbox = document.getElementById("portfolio-lightbox");
    var lbImg = document.getElementById("portfolio-lightbox-img");
    var lbFolder = document.getElementById("portfolio-lightbox-folder");
    var lbClose = document.getElementById("portfolio-lightbox-close");
    var lbPrev = lightbox ? lightbox.querySelector(".portfolio-lightbox__arrow--prev") : null;
    var lbNext = lightbox ? lightbox.querySelector(".portfolio-lightbox__arrow--next") : null;
    var grid = document.getElementById("portfolio-grid");
    var cenografiaPhotos = document.querySelectorAll("#cenografia .cenografia-photo__img");

    if (!lightbox || !lbImg || !lbFolder) return;

    var slides = [];
    var cards = grid ? grid.querySelectorAll(".segment--portfolio") : [];

    var n = 0;
    var i = 0;
    var lightboxOpen = false;

    function altFor(folder) {
      return "Montagem 071 Estruturas — " + folder;
    }

    function syncLightboxSlide() {
      if (!slides.length || !slides[i]) return;
      var s = slides[i];
      var queue = portfolioImageUrlVariants(s.src).slice();

      function clearLbImgListeners() {
        lbImg.onload = null;
        lbImg.onerror = null;
      }

      lbImg.onload = function () {
        clearLbImgListeners();
      };
      lbImg.onerror = function () {
        if (!queue.length) {
          clearLbImgListeners();
          return;
        }
        lbImg.src = queue.shift();
      };

      lbImg.src = queue.shift();
      lbImg.alt = altFor(s.folder);
      lbFolder.textContent = s.folder;
    }

    function go(delta) {
      i = (i + delta + n) % n;
      if (lightboxOpen) {
        syncLightboxSlide();
      }
    }

    function openLightboxAt(startIndex) {
      i = Math.max(0, Math.min(startIndex, n - 1));
      lightboxOpen = true;
      lightbox.removeAttribute("hidden");
      syncLightboxSlide();
      document.body.style.overflow = "hidden";
      if (lbClose) {
        lbClose.focus();
      }
    }

    function closeLightbox() {
      lightboxOpen = false;
      lightbox.setAttribute("hidden", "");
      document.body.style.overflow = "";
    }

    var cardPromises = Array.prototype.map.call(cards, function (card) {
      var raw = String(card.getAttribute("data-portfolio-slides") || "");
      var folderAttr = String(card.getAttribute("data-portfolio-folder") || "").trim();
      var footerEl = card.querySelector(".segment__photo-footer");
      var folder =
        folderAttr ||
        (footerEl ? String(footerEl.textContent || "").replace(/\s+/g, " ").trim() : "");
      if (!raw || !folder) {
        return Promise.resolve(null);
      }

      var urls = raw
        .split(",")
        .map(function (p) {
          return p.trim();
        })
        .filter(Boolean);
      if (!urls.length) {
        return Promise.resolve(null);
      }

      return discoverExtraPortfolioUrls(urls).then(function (fullUrls) {
        return { card: card, folder: folder, urls: fullUrls };
      });
    });

    function displayedSrcForImage(img) {
      var current = String(img.currentSrc || "").trim();
      if (current) return current;
      var src = String(img.getAttribute("src") || "").trim();
      if (!src) return "";
      return src;
    }

    Promise.all(cardPromises).then(function (results) {
      results.forEach(function (item) {
        if (!item || !item.urls || !item.urls.length) return;

        var startIndex = slides.length;
        item.urls.forEach(function (src) {
          slides.push({ src: src, folder: item.folder });
        });

        var hit = item.card.querySelector(".segment__photo-hit");
        if (hit) {
          hit.addEventListener("click", function () {
            openLightboxAt(startIndex);
          });
        }
      });

      var cenografiaStartIndex = slides.length;
      Array.prototype.forEach.call(cenografiaPhotos, function (img) {
        var src = displayedSrcForImage(img);
        if (!src) return;
        slides.push({ src: src, folder: "Cenografia" });
      });

      Array.prototype.forEach.call(cenografiaPhotos, function (img, idx) {
        var figure = img.closest(".cenografia-photo");
        if (!figure) return;
        figure.setAttribute("role", "button");
        figure.setAttribute("tabindex", "0");
        figure.setAttribute("aria-label", "Ampliar foto de Cenografia");
        figure.addEventListener("click", function () {
          openLightboxAt(cenografiaStartIndex + idx);
        });
        figure.addEventListener("keydown", function (e) {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            openLightboxAt(cenografiaStartIndex + idx);
          }
        });
      });

      if (!slides.length) return;

      n = slides.length;

      if (lightbox) {
        lightbox.querySelectorAll("[data-portfolio-lightbox-close]").forEach(function (el) {
          el.addEventListener("click", function () {
            closeLightbox();
          });
        });
      }
      if (lbClose) {
        lbClose.addEventListener("click", function () {
          closeLightbox();
        });
      }
      if (lbPrev) {
        lbPrev.addEventListener("click", function (e) {
          e.stopPropagation();
          go(-1);
        });
      }
      if (lbNext) {
        lbNext.addEventListener("click", function (e) {
          e.stopPropagation();
          go(1);
        });
      }

      document.addEventListener("keydown", function (e) {
        if (!lightboxOpen) return;
        if (e.key === "Escape") {
          closeLightbox();
        } else if (e.key === "ArrowLeft") {
          e.preventDefault();
          go(-1);
        } else if (e.key === "ArrowRight") {
          e.preventDefault();
          go(1);
        }
      });
    });
  })();

  if (form) {
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      setFormFeedback("", "");
      if (form.getAttribute("data-submitting") === "1") return;
      if (!form.checkValidity()) {
        form.reportValidity();
        return;
      }

      var nome = String(form.nome.value || "").trim();
      var email = String(form.email.value || "").trim();
      var mensagem = String(form.mensagem.value || "").trim();

      form.setAttribute("data-submitting", "1");
      var submitBtn = form.querySelector(".form-submit-contact");
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = "ENVIANDO...";
      }

      fetch("https://formspree.io/f/xdabdzqa", {
        method: "POST",
        headers: {
          "Accept": "application/json",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ nome: nome, email: email, mensagem: mensagem })
      })
      .then(function (res) {
        if (!res.ok) throw new Error("Falha");
        return res.json();
      })
      .then(function () {
        setFormFeedback("success", "Mensagem enviada com sucesso! Em breve entraremos em contato.");
        form.reset();
      })
      .catch(function () {
        setFormFeedback("error", "Não foi possível enviar agora. Tente novamente em instantes.");
      })
      .finally(function () {
        form.setAttribute("data-submitting", "0");
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = "ENVIAR";
        }
      });
    });
  }
})();
