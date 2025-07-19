var quoteArr = [
    "我们所知的只是沧海一粟，我们未知的却是汪洋大海。",
    "当你的才华还撑不起你的野心时，那就静下来学习吧！——莫言",
    "月亮很美，美也没用，没用也美"
    // 其他名言...
];

try {
    new Typed("#tellu", {
        strings: quoteArr,
        typeSpeed: 80,
        backSpeed: 25,
        loop: true,
        showCursor: true
    });
} catch (err) {
    console.error("Typed.js 初始化失败:", err);
}