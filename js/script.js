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
                document.getElementById("mobile-toggle-theme").innerText = "路 Dark"
            } else {
                window.sessionStorage.theme = 'light'
                pagebody.classList.remove('dark-theme');
                document.getElementById("switch_default").checked = false
                document.getElementById("mobile-toggle-theme").innerText = "路 Light"
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
            document.getElementById("mobile-toggle-theme").innerText = window.sessionStorage.theme === 'light' ? "路 Light" : "路 Dark"
        })
    }
);

const addCopyButtons = () => {
    const codeBlocks = document.querySelectorAll('figure.highlight');
    console.log('Found code blocks:', codeBlocks.length);
    
    codeBlocks.forEach(codeBlock => {
        if (codeBlock.querySelector('.copy-btn')) return;
        
        const copyBtn = document.createElement('button');
        copyBtn.className = 'copy-btn';
        copyBtn.textContent = '复制';
        
        codeBlock.style.position = 'relative';
        codeBlock.appendChild(copyBtn);
        
        copyBtn.addEventListener('click', async () => {
            const codeElement = codeBlock.querySelector('td.code pre');
            if (!codeElement) return;
            
            const text = codeElement.textContent;
            
            try {
                await navigator.clipboard.writeText(text);
                copyBtn.textContent = '已复制';
                copyBtn.classList.add('copied');
                
                setTimeout(() => {
                    copyBtn.textContent = '复制';
                    copyBtn.classList.remove('copied');
                }, 2000);
            } catch (err) {
                copyBtn.textContent = '失败';
                setTimeout(() => {
                    copyBtn.textContent = '复制';
                }, 2000);
            }
        });
    });
};

document.addEventListener('DOMContentLoaded', function() {
    console.log('DOM loaded, adding copy buttons...');
    addCopyButtons();
});

window.addEventListener('load', function() {
    console.log('Window loaded, adding copy buttons...');
    addCopyButtons();
});

if (document.body) {
    const observer = new MutationObserver(function(mutations) {
        addCopyButtons();
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true
    });
}
