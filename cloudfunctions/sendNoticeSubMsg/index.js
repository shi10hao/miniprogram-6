const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()
const _ = db.command
const USERS = 'users'

const NOTICE_TMPL_ID = '9Lr3yHaJzl8LyzC5qbNGFYgu5ILBFc3XSowjJRv1-eg'

// thing 类型微信限制 20 个字符
function cutStr(str, len = 20) {
  if (!str) return ''
  str = String(str).replace(/\s+/g, ' ').trim()
  if (str.length <= len) return str
  return str.slice(0, len - 1) + '…'
}

// time3 尽量给可读时间；微信 time.DATA 支持如 "2026年9月7日 20:30" 这类格式
function formatTime(input) {
  if (!input) return ''
  let d
  if (input instanceof Date) {
    d = input
  } else {
    d = new Date(input.replace(/-/g, '/'))
  }
  if (isNaN(d.getTime())) return String(input)
  const y = d.getFullYear()
  const m = d.getMonth() + 1
  const day = d.getDate()
  const h = String(d.getHours()).padStart(2, '0')
  const min = String(d.getMinutes()).padStart(2, '0')
  return `${y}年${m}月${day}日 ${h}:${min}`
}

exports.main = async (event = {}) => {
  const {
    title = '', content = '', publishDate = '', page = 'pages/notice/list', batchSize = 100, concurrency = 5
  } = event

  const data = {
    thing30: {
      value: cutStr(title, 20)
    },
    time3: {
      value: formatTime(publishDate || new Date())
    },
    thing2: {
      value: cutStr(content, 20)
    }
  }
  // 查询学生总数
  const countRes = await db.collection('users')
    .where({
      role: 'student'
    }) // 假设只发给学生
    .count();
  const total = countRes.total;

  // 计算需要分几批
  const batchTimes = Math.ceil(total / batchSize);

  // 保存所有批次的查询任务
  const queryTasks = [];
  for (let i = 0; i < batchTimes; i++) {
    queryTasks.push(
      db.collection('users')
      .where({
        role: 'student'
      })
      .skip(i * batchSize)
      .limit(batchSize)
      .field({
        _openid: true,
        _id: true
      }) // 只取必要字段
      .get()
    );
  }

  // 并行执行所有查询（注意：查询本身通常不会触发限流）
  const results = await Promise.all(queryTasks);
  const allUsers = results.reduce((acc, cur) => acc.concat(cur.data), []);

  if (allUsers.length === 0) {
    return {
      success: true,
      total: 0,
      sent: 0,
      results: []
    };
  }

  // 分批并行发送（控制并发数）
  const sendResults = [];
  for (let i = 0; i < allUsers.length; i += concurrency) {
    const batch = allUsers.slice(i, i + concurrency);
    const batchPromises = batch.map(async (u) => {
      try {
        await cloud.openapi.subscribeMessage.send({
          touser: u._openid,
          template_id: NOTICE_TMPL_ID,
          page,
          data,
          miniprogramState: 'developer',
          lang: 'zh_CN'
        });
        return {
          openid: u._openid,
          ok: true
        };
      } catch (err) {
        console.error('发送失败', u._openid, err);
        return {
          openid: u._openid,
          ok: false,
          errCode: err && err.errCode
        };
      }
    });
    const batchResults = await Promise.all(batchPromises);
    sendResults.push(...batchResults);
  }

  const okCount = sendResults.filter(r => r.ok).length;
  return {
    success: true,
    total: allUsers.length,
    sent: okCount,
    results: sendResults
  };

}