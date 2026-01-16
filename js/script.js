// declaraction of document.ready() function.
(function () {
    var ie = !!(window.attachEvent && !window.opera);
    var wk = /webkit\/(\d+)/i.test(navigator.userAgent) && (RegExp.$1 < 525);
    var fn = [];
    var run = function () {
        for (var i = 0; i < fn.length; i++) fn[i]();
    };
    var d = document;
    d.ready = function (f) {
        if (!ie && !wk && d.addEventListener)
            return d.addEventListener('DOMContentLoaded', f, false);
        if (fn.push(f) > 1) return;
        if (ie)
            (function () {
                try {
                    d.documentElement.doScroll('left');
                    run();
                } catch (err) {
                    setTimeout(arguments.callee, 0);
                }
            })();
        else if (wk)
            var t = setInterval(function () {
                if (/^(loaded|complete)$/.test(d.readyState))
                    clearInterval(t), run();
            }, 0);
    };
})();


document.ready(
    // toggleTheme function.
    // this script shouldn't be changed.
    () => {
        const pagebody = document.getElementsByTagName('body')[0]

        const default_theme = 'light' // 'dark'

        function setTheme(status = 'light') {
            if (status === 'dark') {
                window.sessionStorage.theme = 'dark'
                pagebody.classList.add('dark-theme');
                document.getElementById("switch_default").checked = true
                document.getElementById("mobile-toggle-theme").innerText = "· Dark"
            } else {
                window.sessionStorage.theme = 'light'
                pagebody.classList.remove('dark-theme');
                document.getElementById("switch_default").checked = false
                document.getElementById("mobile-toggle-theme").innerText = "· Light"
            }
        };

        setTheme(window.sessionStorage.theme ?? default_theme)

        document.getElementsByClassName('toggleBtn')[0].addEventListener('click', () => {
            window.sessionStorage.theme = window.sessionStorage.theme === 'dark' ? 'light' : 'dark'
            setTheme(window.sessionStorage.theme)
            document.getElementById("switch_default").checked = window.sessionStorage.theme === 'light'
        })
        document.getElementById('mobile-toggle-theme').addEventListener('click', () => {
            window.sessionStorage.theme = window.sessionStorage.theme === 'dark' ? 'light' : 'dark'
            setTheme(window.sessionStorage.theme)
            document.getElementById("mobile-toggle-theme").innerText = window.sessionStorage.theme === 'light' ? "· Light" : "· Dark"
        })

        // Keyboard shortcuts for post navigation
        document.addEventListener('keydown', (e) => {
            // Check if we're on a post page (has post-wrap class)
            const isPostPage = document.querySelector('.post-wrap');
            if (!isPostPage) return;

            // Prevent default behavior for arrow keys to avoid scrolling conflicts
            if (e.keyCode === 37 || e.keyCode === 39) {
                e.preventDefault();
            }

            switch (e.keyCode) {
                case 37: // Left arrow - Previous post
                    const prevLink = document.querySelector('.post-nav .prev');
                    if (prevLink) {
                        window.location.href = prevLink.href;
                    }
                    break;
                case 39: // Right arrow - Next post
                    const nextLink = document.querySelector('.post-nav .next');
                    if (nextLink) {
                        window.location.href = nextLink.href;
                    }
                    break;
            }
        });
        
        // Add copy button to code blocks
        const addCopyButtons = () => {
            // Get all code blocks
            const codeBlocks = document.querySelectorAll('figure.highlight');
            
            codeBlocks.forEach((block) => {
                // Check if copy button already exists
                if (block.querySelector('.copy-btn')) return;
                
                // Create copy button
                const copyBtn = document.createElement('button');
                copyBtn.className = 'copy-btn';
                copyBtn.textContent = 'Copy';
                
                // Add click event
                copyBtn.addEventListener('click', () => {
                    // Get code content
                    const codeContent = block.querySelector('.code pre').textContent;
                    
                    // Copy to clipboard
                    navigator.clipboard.writeText(codeContent).then(() => {
                        // Show copied state
                        copyBtn.textContent = 'Copied!';
                        copyBtn.classList.add('copied');
                        
                        // Reset after 2 seconds
                        setTimeout(() => {
                            copyBtn.textContent = 'Copy';
                            copyBtn.classList.remove('copied');
                        }, 2000);
                    }).catch((err) => {
                        console.error('Failed to copy: ', err);
                        copyBtn.textContent = 'Error';
                        
                        setTimeout(() => {
                            copyBtn.textContent = 'Copy';
                        }, 2000);
                    });
                });
                
                // Add button to code block
                block.appendChild(copyBtn);
            });
        };
        
        // Run when DOM is ready
        addCopyButtons();
        
        // Also run when tocbot initializes (for dynamic content)
        if (typeof tocbot !== 'undefined') {
            const originalInit = tocbot.init;
            tocbot.init = function(options) {
                const result = originalInit.call(this, options);
                setTimeout(addCopyButtons, 100); // Add copy buttons after tocbot initializes
                return result;
            };
        }
    }
);
