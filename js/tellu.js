
/**随机获取一句话
 * @method getQuote
 * @return {String}
 */
var quoteArr = [
    //俚语
    "我们所知的只是沧海一粟，我们未知的却是汪洋大海。",
    "当你的才华还撑不起你的野心时，那就静下来学习吧！莫言",

    // 诗歌/小说
    "不要因为走得太远，忘了我们为什么出发。 纪伯伦《先知》",
    "与其孤独跋涉，不如安然沉睡，我们仍会醒来。 江南《龙族3·黑月之潮》",
    "当所有传奇写下第一个篇章，原来所谓英雄也和我们一样。 《网游之练级专家》",
    "与恶龙缠斗过久，自身亦成为恶龙。 弗里德里希·尼采《善恶的彼岸》",
    "从明天起，做一个幸福的人。喂马，劈柴，周游世界。 海子《面朝大海，春暖花开》",
    "我有一所房子，面朝大海，春暖花开。 海子《面朝大海，春暖花开》",
    "陌生人，我也为你祝福。 海子《面朝大海，春暖花开》",
    "越是艰难处，越是修心时。 王阳明",
    "待到秋来九月八，我花开后百花杀。冲天香阵透长安，满城尽带黄金甲。黄巢《不第后赋菊》",
    "他时若遂凌云志，敢笑黄巢不丈夫。《水浒传·第三十九回》",
    "尔俸尔禄，民膏民脂。下民易虐，上天难欺。孟昶《颁令箴》",
    "侠之大者，为国为民。金庸《神雕侠侣》",



]


// function getQuote(quoteArr) {
//     return quoteArr[Math.floor(Math.random() * quoteArr.length)] // 数组中随机取一个元素
// }

// var tellu = document.getElementById("tellu");
// tellu.innerHTML = getQuote(quoteArr);



try {
    var typed = new Typed("#tellu", {
        strings: quoteArr,
        startDelay: 0,
        typeSpeed: 80,
        loop: true,
        backSpeed: 25,
        showCursor: true
    });
} catch (err) {
    console.log(err)
}
