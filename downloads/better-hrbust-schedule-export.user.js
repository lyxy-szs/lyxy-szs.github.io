// ==UserScript==
// @name         BetterHRBUST 课表读取与导出（精简版）
// @namespace    https://github.com/Glassous/BetterHRBUST
// @version      1.0.0
// @description  从 BetterHRBUST(哈理工教务在线) 精简而来，仅保留“读取”能力：在登录态下读取学生信息、当前学期与课表，并在页面注入一个导出按钮，一键导出符合《课表 JSON 数据交换规范 v1.0》的 student_schedule.json，同时导出开发分析日志(.log)。
// @author       Glassous (精简/导出模块)
// @match        *://jwzx.hrbust.edu.cn/academic/*
// @run-at       document-end
// @noframes
// @grant        none
// @license      MIT
// ==/UserScript==

/*
 * 说明
 * ------------------------------------------------------------------
 * 本脚本由 BetterHRBUST 构建产物精简而来，只做三件事：
 *   1) 读取：学生上下文 / 个人档案 / 日历(公告) / 课表(大节+小节)
 *   2) 转换：把教务原始数据映射为《课表 JSON 数据交换规范 v1.0》
 *   3) 导出：下载 student_schedule.json + 开发分析日志(.log)
 * 只处理“当前学期”（以 student/currcourse 返回的 year/term 为准）。
 *
 * 原始脚本中所有与读取无关的部分（Vue 界面、成绩/GPA、教学评价、
 * 空教室、资料查找、ICS 导出、缓存体系等）均已被移除。
 * ------------------------------------------------------------------
 */

;(function () {
  'use strict';

  /* ============================================================
   * 0. 基础常量
   * ============================================================ */

  var SCRIPT_NAME = 'BetterHRBUST 课表导出';
  var SCRIPT_VERSION = '1.0.0';
  var SCHEMA_VERSION = '1.0.0';
  var BASE = '/academic/';

  // 节次时间表（来自原脚本常量，勿改）
  // 大节模式 COMBINE：1~6 大节
  var BIG_SECTIONS = [
    '08:10-09:50', // 第 1 大节 = 第 1-2 小节
    '10:10-11:50', // 第 2 大节 = 第 3-4 小节
    '13:30-15:10', // 第 3 大节 = 第 5-6 小节
    '15:30-17:10', // 第 4 大节 = 第 7-8 小节
    '18:00-19:40', // 第 5 大节 = 第 9-10 小节
    '19:50-21:30'  // 第 6 大节 = 第 11-12 小节
  ];
  // 小节模式 BASE：1~12 小节
  var SMALL_SECTIONS = [
    '08:10-08:55', '09:05-09:50', '10:10-10:55', '11:05-11:50',
    '13:30-14:15', '14:25-15:10', '15:30-16:15', '16:25-17:10',
    '18:00-18:45', '18:55-19:40', '19:50-20:35', '20:45-21:30'
  ];

  /* ============================================================
   * 1. 工具函数
   * ============================================================ */

  function pad2(n) { return String(n).padStart(2, '0'); }

  function nowStamp() {
    var d = new Date();
    return d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) + '_' +
      pad2(d.getHours()) + pad2(d.getMinutes()) + pad2(d.getSeconds());
  }

  function isoWithOffset(date) {
    // 输出形如 2026-10-10T20:00:00+08:00
    var d = date || new Date();
    var tz = -d.getTimezoneOffset();
    var sign = tz >= 0 ? '+' : '-';
    var tzH = pad2(Math.floor(Math.abs(tz) / 60));
    var tzM = pad2(Math.abs(tz) % 60);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) +
      'T' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds()) +
      sign + tzH + ':' + tzM;
  }

  function ymd(date) {
    var d = date || new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function trim(s) { return (s == null ? '' : String(s)).replace(/\s+/g, ' ').trim(); }

  function empty(s) { return trim(s) === ''; }

  // ---- HTML 实体解码（移植自原脚本）----
  var NAMED_ENTITIES = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
    copy: '©', reg: '®', trade: '™', hellip: '…', mdash: '—', ndash: '–',
    middot: '·', deg: '°', laquo: '«', raquo: '»',
    ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’'
  };

  function safeFromCodePoint(cp, fallback) {
    return (Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff) ? String.fromCodePoint(cp) : fallback;
  }

  function decodeEntities(input) {
    if (!input || input.indexOf('&') < 0) return input || '';
    var re = /&(?:#x([0-9a-fA-F]+)|#(\d+)|([a-zA-Z][a-zA-Z0-9]*));/g;
    var out = input;
    for (var i = 0; i < 3; i++) {
      var next = out.replace(re, function (whole, hex, dec, name) {
        if (hex) return safeFromCodePoint(parseInt(hex, 16), whole);
        if (dec) return safeFromCodePoint(parseInt(dec, 10), whole);
        var v = NAMED_ENTITIES[name.toLowerCase()];
        return v !== undefined ? v : whole;
      });
      if (next === out) break;
      out = next;
    }
    return out;
  }

  function parseDoc(html) {
    return new DOMParser().parseFromString(html, 'text/html');
  }

  /* ============================================================
   * 2. 网络层（同源直连教务系统，携带登录 Cookie）
   * ============================================================ */

  function absUrl(path) {
    if (!path) return location.origin + BASE;
    if (/^https?:/i.test(path)) return path;
    var p = String(path).replace(/^\/+/, '');
    if (p.indexOf('academic/') === 0) return location.origin + '/' + p;
    return location.origin + BASE + p;
  }

  function decodeBuffer(buffer, encoding) {
    var enc = String(encoding || 'utf-8').toLowerCase();
    if (/gbk|gb2312|gb18030/.test(enc)) enc = 'gbk';
    else enc = 'utf-8';
    try {
      return new TextDecoder(enc).decode(buffer);
    } catch (e) {
      return new TextDecoder('utf-8').decode(buffer);
    }
  }

  function isLoginPage(html) {
    var t = String(html || '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
    return /<form\b[^>]*\baction\s*=\s*["'][^"']*j_acegi_security_check/i.test(t) ||
      /<input\b[^>]*\bname\s*=\s*["']j_captcha["']/i.test(t);
  }

  function doFetchRaw(path, options) {
    var opts = options || {};
    var url = absUrl(path);
    var init = {
      method: opts.method || 'GET',
      credentials: 'include',
      headers: Object.assign({
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'X-Requested-With': 'XMLHttpRequest'
      }, opts.headers || {})
    };
    if (opts.body != null) {
      if (opts.body instanceof URLSearchParams || opts.body instanceof FormData) {
        init.body = opts.body;
      } else {
        init.body = new URLSearchParams(opts.body);
        init.headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
      }
    }
    return fetch(url, init).then(function (res) {
      return res.arrayBuffer().then(function (buf) {
        return { ok: res.ok, status: res.status, url: url, buffer: buf };
      });
    });
  }

  // 读取一个页面：返回 { html, status, url, bytes }
  function getPage(path, encoding, options) {
    return doFetchRaw(path, options).then(function (r) {
      var html = decodeBuffer(r.buffer, encoding);
      if (!r.ok) {
        var e1 = new Error('教务请求失败 (HTTP ' + r.status + ')：' + path);
        e1.httpStatus = r.status;
        throw e1;
      }
      if (isLoginPage(html)) {
        var e2 = new Error('教务会话已失效或未登录，请先在教务在线完成登录');
        e2.expired = true;
        throw e2;
      }
      return { html: html, status: r.status, url: r.url, bytes: r.buffer.byteLength };
    }).catch(function (err) {
      if (err && (err.expired || err.httpStatus)) throw err;
      throw new Error('网络连接失败：' + (err && err.message ? err.message : err) +
        '（请确认处于校园网 / VPN 环境）');
    });
  }

  /* ============================================================
   * 3. 解析器（移植自原脚本，逻辑保持一致）
   * ============================================================ */

  // 3.1 学生上下文：student/currcourse/currcourse.jsdo
  function parseStudentContext(html) {
    var doc = parseDoc(html);
    var studentId = '', year = '';
    var m = html.match(/studentid=["']?(\d+)["']?[\s\S]*?year=["']?(\d+)["']?/i);
    if (m) { studentId = m[1]; year = m[2]; }
    else {
      var m1 = html.match(/studentid\s*=\s*["']?(\d+)["']?/i);
      var m2 = html.match(/year\s*=\s*["']?(\d+)["']?/i);
      if (m1) studentId = m1[1];
      if (m2) year = m2[1];
    }
    var term = '';
    var sel = doc.querySelector('select[name="term"]');
    if (sel) {
      var opt = sel.querySelector('option[selected]') || (sel.selectedOptions && sel.selectedOptions[0]);
      if (opt) term = opt.value;
    }
    var courses = [];
    var table = doc.querySelector('table.infolist_tab');
    if (table) {
      table.querySelectorAll('tr.infolist_common').forEach(function (tr) {
        var td = tr.querySelectorAll('td');
        if (td.length < 6) return;
        courses.push({
          courseId: trim(td[0] && td[0].textContent),
          courseSeq: trim(td[1] && td[1].textContent),
          courseName: trim(td[2] && td[2].textContent),
          teacher: trim(td[3] && td[3].textContent),
          credit: parseFloat(trim(td[4] && td[4].textContent)) || null,
          property: trim(td[5] && td[5].textContent),
          examWay: trim(td[6] && td[6].textContent),
          examType: trim(td[7] && td[7].textContent),
          timeAndPlace: trim(td[9] && td[9].textContent)
        });
      });
    }
    return { studentId: studentId, year: year, term: term, courses: courses };
  }

  // 3.2 个人档案：showPersonalInfo.do
  function parsePersonalInfo(html) {
    var doc = parseDoc(html);
    var info = {
      studentNumber: '', realName: '', college: '', major: '', direction: '',
      studentType: '', grade: '', className: '', idCard: '', email: '',
      phone: '', address: '', postalCode: ''
    };
    var form = doc.querySelector('table.form');
    if (form) {
      form.querySelectorAll('tr').forEach(function (tr) {
        var ths = tr.querySelectorAll('th');
        var tds = tr.querySelectorAll('td');
        for (var i = 0; i < ths.length; i++) {
          var label = trim(ths[i] && ths[i].textContent);
          var val = trim((tds[i] && tds[i].textContent || '').replace(/&nbsp;/g, ''));
          if (!label || val === undefined) continue;
          if (label.indexOf('用户名') >= 0) info.studentNumber = val;
          else if (label.indexOf('真实姓名') >= 0) info.realName = val;
          else if (label.indexOf('所在院系') >= 0) info.college = val;
          else if (label.indexOf('专业') >= 0 && label.indexOf('方向') < 0) info.major = val;
          else if (label.indexOf('方向') >= 0) info.direction = val;
          else if (label.indexOf('学生类别') >= 0) info.studentType = val;
          else if (label.indexOf('年级') >= 0) info.grade = val;
          else if (label.indexOf('班级') >= 0) info.className = val;
          else if (label.indexOf('证件号码') >= 0) info.idCard = val;
          else if (label.indexOf('电子邮箱') >= 0) info.email = val;
          else if (label.indexOf('联系电话') >= 0) info.phone = val;
          else if (label.indexOf('通讯地址') >= 0) info.address = val;
          else if (label.indexOf('邮政编码') >= 0) info.postalCode = val;
        }
      });
    }
    return info;
  }

  // 3.3 日历 / 公告：calendarinfo/viewCalendarInfo.do
  function parseCalendarInfo(html) {
    var doc = parseDoc(html);
    var currentWeek = 1;
    var weekEl = doc.querySelector('.week td.cur span') || doc.querySelector('.curweek strong');
    if (weekEl) {
      var w = parseInt(trim(weekEl.textContent), 10);
      if (!isNaN(w)) currentWeek = w;
    }
    var semesterName = '';
    var cur = doc.querySelector('.curweek');
    if (cur) semesterName = trim(cur.textContent.replace(/\s+/g, ' ').replace(/第.*周/, ''));
    // 尝试抓取日历中的日期区间（仅作日志参考）
    var dateCandidates = [];
    var re = /(\d{4})\s*[-\/年.]\s*(\d{1,2})\s*[-\/月.]\s*(\d{1,2})/g, mm;
    while ((mm = re.exec(html)) !== null) {
      dateCandidates.push(mm[1] + '-' + pad2(mm[2]) + '-' + pad2(mm[3]));
    }
    return { currentWeek: currentWeek, semesterName: semesterName, dateCandidates: dateCandidates.slice(0, 30) };
  }

  // 3.4 课表：manager/coursearrange/showTimetable.do
  function parseTimetable(html) {
    var doc = parseDoc(html);
    var table = doc.querySelector('table#timetable');
    var cells = [], unarranged = [];
    if (table) {
      table.querySelectorAll('tr.infolist_hr_common').forEach(function (row, rowIdx) {
        var th = row.querySelector('th');
        var sectionLabel = th
          ? (trim(decodeEntities(th.innerHTML.replace(/<br\s*\/?>/gi, ' '))) || trim(decodeEntities(th.textContent)))
          : ('第' + (rowIdx + 1) + '大节');
        row.querySelectorAll('td').forEach(function (td, colIdx) {
          var id = td.getAttribute('id') || '';
          var inner = td.innerHTML.trim();
          if (!inner || inner === '&nbsp;' || trim(td.textContent) === '') return;
          // 关键：按 <br> 分行后“保留位置”，不删除空行，
          // 以保证 [0]课程名 [1]地点 [2]教师 [3]周次 [4]类型 的位置对齐。
          var lines = inner.split(/<br\s*\/?>/i)
            .map(function (seg) { return trim(decodeEntities(seg.replace(/<[^>]+>/g, ''))); });
          while (lines.length && lines[lines.length - 1] === '') lines.pop(); // 去掉行尾空行
          if (!lines.length || trim(lines[0]) === '') return;

          var courseName = lines[0] || '';
          var courseSeq = '';
          var mm = courseName.match(/<<?(.*?)(?:>>|;)?(?:\s*;\s*(\d+))?$/);
          if (mm) { courseName = mm[1] || courseName; courseSeq = mm[2] || ''; }
          courseName = courseName.replace(/^[<《]+|[>》]+$/g, '').trim();

          var location = lines[1] || '';
          var teacher = lines[2] || '';
          var weeks = lines[3] || '';
          var hoursType = lines[4] || '';

          var day = colIdx + 1;
          var idSecond = '';
          if (id) {
            var parts = id.split('-');
            var d = parseInt(parts[0], 10);
            if (d >= 1 && d <= 7) day = d;
            if (parts[1] && /^\d+$/.test(parts[1])) idSecond = parts[1];
          }

          cells.push({
            id: id,
            idSecond: idSecond,
            day: day,
            sectionIndex: rowIdx + 1,
            sectionLabel: sectionLabel,
            courseName: courseName,
            courseSeq: courseSeq,
            location: location,
            teacher: teacher,
            weeks: weeks,
            hoursType: hoursType,
            rawLines: lines
          });
        });
      });
    }

    var noArr = doc.querySelector('table#noArrangement');
    if (noArr) {
      var rows = noArr.querySelectorAll('tr');
      for (var i = 1; i < rows.length; i++) {
        var tds = rows[i].querySelectorAll('td');
        if (tds.length >= 8) {
          unarranged.push({
            courseId: trim(tds[0] && tds[0].textContent),
            courseName: trim(tds[1] && tds[1].textContent),
            courseSeq: trim(tds[2] && tds[2].textContent),
            teacher: trim(tds[3] && tds[3].textContent),
            mergeClass: trim(tds[4] && tds[4].textContent),
            weeks: trim(tds[5] && tds[5].textContent),
            day: trim(tds[6] && tds[6].textContent),
            location: trim(tds[7] && tds[7].textContent)
          });
        }
      }
    }
    return { cells: cells, unarranged: unarranged };
  }

  /* ============================================================
   * 4. 读取 API（只保留读取）
   * ============================================================ */

  var Api = {
    getStudentContext: function () {
      return getPage('student/currcourse/currcourse.jsdo', 'gbk')
        .then(function (r) { return parseStudentContext(r.html); });
    },
    getPersonalInfo: function () {
      return getPage('showPersonalInfo.do', 'utf-8')
        .then(function (r) { return parsePersonalInfo(r.html); });
    },
    getCalendarInfo: function (week) {
      var path = week ? ('calendarinfo/viewCalendarInfo.do?week=' + week) : 'calendarinfo/viewCalendarInfo.do';
      return getPage(path, 'utf-8').then(function (r) { return parseCalendarInfo(r.html); });
    },
    getTimetable: function (params) {
      var st = params.sectionType || 'COMBINE';
      var path = 'manager/coursearrange/showTimetable.do?id=' + encodeURIComponent(params.studentId) +
        '&yearid=' + encodeURIComponent(params.yearId) +
        '&termid=' + encodeURIComponent(params.termId) +
        '&timetableType=STUDENT&sectionType=' + st;
      return getPage(path, 'gbk').then(function (r) { return parseTimetable(r.html); });
    }
  };

  /* ============================================================
   * 5. 映射：教务原始数据 -> 规范 JSON
   * ============================================================ */

  // 5.1 周次解析
  function parseWeeksText(text) {
    var raw = trim(text);
    var odd = /单/.test(raw);
    var even = /双/.test(raw);
    var weeks = [];
    var nums = raw.match(/\d+(?:\s*[-~–—]\s*\d+)?/g) || [];
    nums.forEach(function (seg) {
      var p = seg.split(/\s*[-~–—]\s*/).map(Number);
      var a = p[0], b = p[1] || a;
      if (isNaN(a)) return;
      for (var w = a; w <= b; w++) weeks.push(w);
    });
    weeks = Array.from(new Set(weeks)).filter(function (w) { return w > 0; }).sort(function (a, b) { return a - b; });
    if (odd) weeks = weeks.filter(function (w) { return w % 2 === 1; });
    if (even) weeks = weeks.filter(function (w) { return w % 2 === 0; });
    var pattern = odd ? 'odd' : even ? 'even' : 'custom';
    return { raw: raw, pattern: pattern, weeks: weeks };
  }

  // 5.2 大节 -> 节次
  function bigSectionToPeriod(bigIdx) {
    return { start: bigIdx * 2 - 1, end: bigIdx * 2 };
  }
  function timeSplit(rangeStr) {
    if (!rangeStr) return { start: null, end: null };
    var p = String(rangeStr).split('-');
    return { start: p[0] ? p[0].trim() : null, end: p[1] ? p[1].trim() : null };
  }

  // 5.3 课程类型 / 上课形式
  function mapCourseType(property) {
    var p = trim(property);
    if (/必修/.test(p)) return 'required';
    if (/限选|限选课/.test(p)) return 'limited_elective';
    if (/任选|公选|通识/.test(p)) return 'elective';
    if (/选修/.test(p)) return 'elective';
    if (/实践|实习|实验/.test(p)) return 'practice';
    return p ? 'required' : 'required';
  }
  function mapSessionType(cell) {
    var t = trim(cell.hoursType) + ' ' + trim(cell.courseName);
    if (/实验|上机|实训/.test(t)) return 'lab';
    if (/体育/.test(t)) return 'pe';
    if (/实践|实习/.test(t)) return 'practice';
    return 'lecture';
  }

  var TEACHER_PLACEHOLDERS = /^(待定|暂无|未知|无|—+|-+|N\/?A|TBD)$/i;
  function splitTeachers(str) {
    return String(str || '')
      .split(/[、,，;；\/\s]+/)
      .map(function (s) { return s.trim(); })
      .filter(function (s) { return s && !TEACHER_PLACEHOLDERS.test(s); });
  }

  // 5.4 主转换
  function buildExportData(input) {
    var ctx = input.ctx, profile = input.profile, calendar = input.calendar, combine = input.combine;
    var log = input.log;
    var warnings = [];

    // ---- 学期 ----
    var semesterName = trim(calendar.semesterName) || '';
    var academicYear = '';
    var ayMatch = semesterName.match(/(\d{4})\s*[-–—~]\s*(\d{4})/);
    if (ayMatch) academicYear = ayMatch[1] + '-' + ayMatch[2];
    var termNum = null;
    if (/秋|第一学期|第1学期|1/.test(semesterName) && /秋/.test(semesterName)) termNum = 1;
    else if (/春/.test(semesterName)) termNum = 2;
    else if (/夏/.test(semesterName)) termNum = 2;
    if (termNum == null) {
      // 回退：使用教务返回的 term 值
      if (String(ctx.term) === '1') termNum = 1;
      else if (String(ctx.term) === '2') termNum = 2;
    }
    if (!academicYear) {
      warnings.push('未能从学期名解析出学年（semesterName="' + semesterName + '"）');
      log.push('[WARN] 学期名解析学年失败: ' + semesterName);
    }
    if (termNum == null) {
      warnings.push('未能解析学期序号(term)');
      log.push('[WARN] 学期序号解析失败, 教务 term=' + ctx.term);
    }

    // ---- 把原始 cells 按 大节 归并成 schedule 记录 ----
    // 同一门课（课程名+课序号）在同一星期、同一大节的多行会合并；
    // 每一次出现的 (星期, 大节, 周次, 地点, 教师) 视为一条 schedule。
    var rawEntries = [];
    (combine.cells || []).forEach(function (c) {
      var w = parseWeeksText(c.weeks);
      var per = bigSectionToPeriod(c.sectionIndex);
      var t = timeSplit(BIG_SECTIONS[c.sectionIndex - 1]);
      rawEntries.push({
        courseName: c.courseName,
        courseSeq: c.courseSeq,
        day: c.day,
        sectionIndex: c.sectionIndex,
        sectionLabel: c.sectionLabel,
        startPeriod: per.start,
        endPeriod: per.end,
        startTime: t.start,
        endTime: t.end,
        weeksRaw: c.weeks,
        weekPattern: w.pattern,
        weeks: w.weeks,
        classroom: c.location || null,
        teacher: c.teacher,
        sessionType: mapSessionType(c),
        raw: c
      });
    });

    // ---- 计算总周数 ----
    var maxWeek = 0;
    rawEntries.forEach(function (e) { e.weeks.forEach(function (w) { if (w > maxWeek) maxWeek = w; }); });
    var totalWeeks = maxWeek > 0 ? maxWeek : 20;
    if (maxWeek === 0) {
      warnings.push('课表未包含任何可解析的周次信息，total_weeks 回退为 20');
      log.push('[WARN] 未能从课表解析出周次，total_weeks 回退 20');
    }

    // all 模式二次判定
    rawEntries.forEach(function (e) {
      if (e.weekPattern !== 'odd' && e.weekPattern !== 'even') {
        var full = [];
        for (var i = 1; i <= totalWeeks; i++) full.push(i);
        var same = e.weeks.length === full.length && e.weeks.every(function (v, idx) { return v === full[idx]; });
        e.weekPattern = same ? 'all' : 'custom';
      }
    });

    // ---- 学生 ----
    var student = {
      name: empty(profile.realName) ? null : profile.realName,
      student_id: empty(profile.studentNumber) ? (ctx.studentId || null) : profile.studentNumber,
      class_name: empty(profile.className) ? null : profile.className,
      college: empty(profile.college) ? null : profile.college,
      major: empty(profile.major) ? null : profile.major,
      grade: empty(profile.grade) ? null : (parseInt(String(profile.grade).replace(/\D/g, ''), 10) || null)
    };
    if (!student.student_id) { warnings.push('缺少学生身份标识 student_id'); }

    // ---- 课程主数据（学分/性质来自 student/currcourse）----
    function findMaster(name, seq) {
      var list = ctx.courses || [];
      // 优先：课程名 + 课序号
      if (seq) {
        var hit = list.find(function (c) { return c.courseName === name && String(c.courseSeq) === String(seq); });
        if (hit) return hit;
      }
      // 其次：课程名
      var hit2 = list.find(function (c) { return c.courseName === name; });
      return hit2 || null;
    }

    // ---- 教师池 ----
    var teacherMap = {};   // name -> id
    var teachers = [];
    function teacherId(name) {
      if (!name) return null;
      if (!teacherMap[name]) {
        var id = 'teacher-' + String(teachers.length + 1).padStart(3, '0');
        teacherMap[name] = id;
        teachers.push({ teacher_id: id, name: name });
      }
      return teacherMap[name];
    }

    // ---- 按课程分组 ----
    var courseOrder = [];
    var courseBucket = {};
    rawEntries.forEach(function (e) {
      var key = e.courseName + '||' + (e.courseSeq || '');
      if (!courseBucket[key]) {
        courseBucket[key] = { name: e.courseName, seq: e.courseSeq, entries: [] };
        courseOrder.push(key);
      }
      courseBucket[key].entries.push(e);
    });

    var courses = [];
    var usedCourseIds = {};
    courseOrder.forEach(function (key, idx) {
      var bucket = courseBucket[key];
      var master = findMaster(bucket.name, bucket.seq);
      var sourceCourseId = master && master.courseId ? master.courseId : null;

      var baseId = sourceCourseId || ('C' + String(idx + 1).padStart(3, '0'));
      var courseId = baseId;
      var suffix = 1;
      while (usedCourseIds[courseId]) { courseId = baseId + '_' + (suffix++); }
      usedCourseIds[courseId] = true;

      var schedule = bucket.entries.map(function (e, i) {
        var tids = splitTeachers(e.teacher).map(teacherId).filter(Boolean);
        return {
          schedule_id: courseId + '-S' + (i + 1),
          weekday: e.day,
          start_period: e.startPeriod,
          end_period: e.endPeriod,
          start_time: e.startTime,
          end_time: e.endTime,
          week_pattern: e.weekPattern,
          weeks: e.weeks,
          classroom: e.classroom,
          campus: null,
          teacher_ids: tids,
          teaching_class: null,
          session_type: e.sessionType,
          date_exceptions: []
        };
      });

      var masterTeachers = splitTeachers(master && master.teacher).map(teacherId).filter(Boolean);

      courses.push({
        course_id: courseId,
        course_name: bucket.name,
        course_type: mapCourseType(master && master.property),
        credits: master && master.credit != null ? master.credit : null,
        hours: null,
        teachers: masterTeachers,
        source_course_id: sourceCourseId,
        schedule: schedule
      });
    });

    // ---- 学期起止日期（估计值，供导入参考；真实值以学校为准）----
    var startDate = null, endDate = null;
    try {
      var today = new Date();
      var cw = calendar.currentWeek || 1;
      var dow = today.getDay() === 0 ? 7 : today.getDay(); // 1..7 (Mon..Sun)
      var mondayThisWeek = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (dow - 1));
      var week1Monday = new Date(mondayThisWeek.getTime() - (cw - 1) * 7 * 86400000);
      startDate = ymd(week1Monday);
      endDate = ymd(new Date(week1Monday.getTime() + (totalWeeks - 1) * 7 * 86400000 + 6 * 86400000));
      log.push('[INFO] 学期起止为“按当前周次反推”的估计值: start=' + startDate + ', end=' + endDate +
        ' (currentWeek=' + cw + ', total_weeks=' + totalWeeks + ')');
    } catch (e) {
      log.push('[WARN] 估计学期日期失败: ' + e.message);
    }

    var exportId = 'export-' + nowStamp();

    var result = {
      schema: { name: 'student_schedule', version: SCHEMA_VERSION, export_id: exportId },
      student: student,
      semester: {
        academic_year: academicYear || null,
        term: termNum,
        start_date: startDate,
        end_date: endDate,
        total_weeks: totalWeeks
      },
      teachers: teachers,
      courses: courses,
      source: {
        system_name: '哈尔滨理工大学教务在线(JWP/URP)',
        source_type: 'html_table',
        source_page: location.href,
        exported_at: isoWithOffset(new Date()),
        parser_version: SCRIPT_VERSION,
        raw_data_preserved: false
      },
      extensions: {
        semester_name: semesterName,
        current_week: calendar.currentWeek || null,
        section_mode: 'COMBINE',
        year_id: ctx.year || null,
        term_id: ctx.term || null
      }
    };

    return { json: result, warnings: warnings };
  }

  /* ============================================================
   * 6. 导出（下载文件）
   * ============================================================ */

  function download(filename, content, mime) {
    var blob = new Blob([content], { type: mime || 'application/octet-stream' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 2000);
  }

  /* ============================================================
   * 7. 主流程
   * ============================================================ */

  function runExport() {
    var log = [];
    var t0 = Date.now();
    log.push('================ BetterHRBUST 课表导出日志 ================');
    log.push('导出时间: ' + isoWithOffset(new Date()));
    log.push('脚本版本: ' + SCRIPT_VERSION + '  /  规范版本: ' + SCHEMA_VERSION);
    log.push('页面地址: ' + location.href);
    log.push('User-Agent: ' + navigator.userAgent);
    log.push('----------------------------------------------------------');

    function step(title, promise, onOk) {
      log.push('[STEP] ' + title + ' ...');
      return promise.then(function (data) {
        log.push('[ OK ] ' + title + ' 完成');
        onOk(data);
        return data;
      }).catch(function (err) {
        log.push('[FAIL] ' + title + ' 失败: ' + (err && err.message ? err.message : err));
        throw err;
      });
    }

    var result = {
      ctx: null, profile: null, calendar: null, combine: null, base: null
    };

    return Api.getStudentContext().then(function (ctx) {
      log.push('[ OK ] 读取学生上下文');
      log.push('   studentId=' + ctx.studentId + ', year=' + ctx.year + ', term=' + ctx.term);
      log.push('   当前学期课程数(from currcourse)=' + (ctx.courses ? ctx.courses.length : 0));
      log.push('   currcourse 课程原始数据: ' + JSON.stringify(ctx.courses, null, 2));
      result.ctx = ctx;
      return Api.getPersonalInfo();
    }).then(function (profile) {
      log.push('[ OK ] 读取个人档案');
      log.push('   ' + JSON.stringify(profile, null, 2));
      result.profile = profile;
      return Api.getCalendarInfo();
    }).then(function (calendar) {
      log.push('[ OK ] 读取日历/公告');
      log.push('   semesterName=' + calendar.semesterName + ', currentWeek=' + calendar.currentWeek);
      if (calendar.dateCandidates && calendar.dateCandidates.length) {
        log.push('   日历页候选日期(仅供参考): ' + calendar.dateCandidates.join(', '));
      }
      result.calendar = calendar;
      return Api.getTimetable({
        studentId: result.ctx.studentId,
        yearId: result.ctx.year,
        termId: result.ctx.term,
        sectionType: 'COMBINE'
      });
    }).then(function (combine) {
      log.push('[ OK ] 读取课表(大节 COMBINE)，cell 数=' + (combine.cells ? combine.cells.length : 0) +
        ', 未排课=' + (combine.unarranged ? combine.unarranged.length : 0));
      log.push('   [原始] 大节 cells: ' + JSON.stringify(combine.cells, null, 2));
      log.push('   [原始] 未排课列表: ' + JSON.stringify(combine.unarranged, null, 2));
      result.combine = combine;
      // 小节模式仅用于日志对比分析
      return Api.getTimetable({
        studentId: result.ctx.studentId,
        yearId: result.ctx.year,
        termId: result.ctx.term,
        sectionType: 'BASE'
      }).catch(function (err) {
        log.push('[WARN] 读取小节课表(BASE)失败(不影响导出): ' + err.message);
        return { cells: [], unarranged: [] };
      });
    }).then(function (base) {
      log.push('[ OK ] 读取课表(小节 BASE)，cell 数=' + (base.cells ? base.cells.length : 0));
      log.push('   [原始] 小节 cells: ' + JSON.stringify(base.cells, null, 2));
      result.base = base;

      // 构建 JSON
      var built = buildExportData({
        ctx: result.ctx,
        profile: result.profile,
        calendar: result.calendar,
        combine: result.combine,
        log: log
      });

      log.push('----------------------------------------------------------');
      log.push('校验提示(warnings): ' + (built.warnings.length ? built.warnings.join('；') : '无'));
      log.push('课程数=' + built.json.courses.length +
        ', 排课记录数=' + built.json.courses.reduce(function (n, c) { return n + c.schedule.length; }, 0) +
        ', 教师数=' + built.json.teachers.length);
      log.push('总周数=' + built.json.semester.total_weeks +
        ', 学期=' + built.json.semester.academic_year + ' 第' + built.json.semester.term + '学期');
      log.push('耗时: ' + (Date.now() - t0) + ' ms');
      log.push('================ 日志结束 ================');

      var stamp = nowStamp();
      var sid = built.json.student.student_id || 'unknown';
      var jsonName = 'student_schedule_' + sid + '_' + stamp + '.json';
      var logName = 'student_schedule_' + sid + '_' + stamp + '.log';

      download(jsonName, JSON.stringify(built.json, null, 2), 'application/json;charset=utf-8');
      download(logName, log.join('\r\n'), 'text/plain;charset=utf-8');

      return { json: built.json, jsonName: jsonName, logName: logName, warnings: built.warnings };
    });
  }

  /* ============================================================
   * 8. 界面（仅一个导出按钮）
   * ============================================================ */

  function buildUI() {
    if (document.getElementById('bh-export-root')) return;

    var root = document.createElement('div');
    root.id = 'bh-export-root';
    root.style.cssText = [
      'position:fixed', 'right:20px', 'bottom:20px', 'z-index:2147483647',
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif',
      'display:flex', 'flex-direction:column', 'align-items:flex-end', 'gap:10px'
    ].join(';');

    var panel = document.createElement('div');
    panel.style.cssText = [
      'max-width:360px', 'padding:10px 14px', 'border-radius:10px',
      'background:rgba(24,24,27,.92)', 'color:#e4e4e7', 'font-size:12px', 'line-height:1.6',
      'box-shadow:0 8px 24px rgba(0,0,0,.35)', 'white-space:pre-wrap', 'word-break:break-all',
      'display:none'
    ].join(';');

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = '导出课表 JSON';
    btn.style.cssText = [
      'padding:10px 18px', 'border:none', 'border-radius:999px', 'cursor:pointer',
      'background:linear-gradient(135deg,#6366f1,#8b5cf6)', 'color:#fff',
      'font-size:13px', 'font-weight:600', 'box-shadow:0 6px 18px rgba(99,102,241,.45)',
      'transition:transform .15s ease,opacity .15s ease'
    ].join(';');
    btn.onmouseenter = function () { btn.style.transform = 'translateY(-1px)'; };
    btn.onmouseleave = function () { btn.style.transform = 'none'; };

    function show(text, isError) {
      panel.style.display = 'block';
      panel.style.color = isError ? '#fca5a5' : '#e4e4e7';
      panel.textContent = text;
    }

    var busy = false;
    btn.addEventListener('click', function () {
      if (busy) return;
      busy = true;
      btn.disabled = true;
      btn.style.opacity = '.7';
      btn.textContent = '正在读取…';
      show('正在读取教务数据（当前学期）…');

      runExport().then(function (res) {
        var msg = '导出完成\n' +
          '课程数：' + res.json.courses.length + '\n' +
          '排课记录：' + res.json.courses.reduce(function (n, c) { return n + c.schedule.length; }, 0) + '\n' +
          (res.warnings.length ? '提示：' + res.warnings.join('；') + '\n' : '') +
          '已下载：\n  ' + res.jsonName + '\n  ' + res.logName;
        show(msg, false);
        btn.textContent = '再次导出';
      }).catch(function (err) {
        var m = err && err.message ? err.message : String(err);
        if (err && err.expired) m = '教务会话已失效，请先登录教务在线后再导出。';
        show('导出失败：' + m, true);
        btn.textContent = '重试导出';
        console.error('[' + SCRIPT_NAME + ']', err);
      }).then(function () {
        busy = false;
        btn.disabled = false;
        btn.style.opacity = '1';
      });
    });

    root.appendChild(panel);
    root.appendChild(btn);
    document.body.appendChild(root);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', buildUI);
  } else {
    buildUI();
  }
})();
