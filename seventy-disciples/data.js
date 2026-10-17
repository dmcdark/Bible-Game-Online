// seventy-disciples/data.js

// 1. 8大初始人物模板
const CHARACTER_TEMPLATES = [
  {
    id: "fisherman",
    name: "加利利渔夫",
    desc: "长年与风浪博击，身体强韧，坚毅沉稳，行军不惧疲劳。",
    stats: { faith: 45, truth: 25, mercy: 35, grit: 55, ap: 3 },
    perk: "风浪同行：遭遇行军惩罚几率降低 50%"
  },
  {
    id: "tax_collector",
    name: "前税吏会账",
    desc: "精于簿记与人情算度，深谙物资调配，善于筹措爱心捐项。",
    stats: { faith: 35, truth: 30, mercy: 25, grit: 40, ap: 3 },
    perk: "丰盛筹措：每回合爱心物资产出 +20%"
  },
  {
    id: "scribe_apprentice",
    name: "法利赛文士门徒",
    desc: "熟读旧约律法与先知书，辨道引经据典，真理根基极其深厚。",
    stats: { faith: 35, truth: 60, mercy: 25, grit: 30, ap: 3 },
    perk: "经义辩驳：会堂辩道成功率额外提升 25%"
  },
  {
    id: "healed_one",
    name: "蒙恩被医治者",
    desc: "亲身蒙主拯救摆脱沉疴污鬼，灵里火热，见证大有感化力。",
    stats: { faith: 60, truth: 20, mercy: 45, grit: 40, ap: 3 },
    perk: "生命见证：宣教时吸引平民信徒速度 +30%"
  },
  {
    id: "tentmaker",
    name: "织帐棚工匠",
    desc: "走南闯北自食其力，通晓希腊语与外邦风俗，亲和力极佳。",
    stats: { faith: 40, truth: 35, mercy: 50, grit: 45, ap: 4 },
    perk: "亲手作工：行动力上限 +1，外邦刚硬度降低更快"
  },
  {
    id: "zealot",
    name: "奋锐党归正客",
    desc: "性格刚烈热忱，为天国大发热心，面对公会审讯与逼迫毫不退缩。",
    stats: { faith: 45, truth: 25, mercy: 25, grit: 65, ap: 3 },
    perk: "无畏壮胆：遭遇公会抓捕与逼迫时免受信心惩罚"
  },
  {
    id: "centurion_kin",
    name: "百夫长罗马官眷",
    desc: "兼具敬虔与罗马政局人脉，熟悉帝国法律，善御官府阻力。",
    stats: { faith: 40, truth: 35, mercy: 35, grit: 45, ap: 3 },
    perk: "行省庇护：罗马官员骚扰与封禁几率减少 40%"
  },
  {
    id: "merchant",
    name: "推罗敬虔商贾",
    desc: "商贸网络遍及地中海各港口，能为跨海宣教提供船只与客店便利。",
    stats: { faith: 35, truth: 30, mercy: 45, grit: 35, ap: 4 },
    perk: "航海通达：海路航行消耗物资减少 50%"
  }
];

// 2. 地图节点与城邦专属挑战议题
const MAP_NODES = {
  "capernaum": {
    id: "capernaum", name: "迦百农", x: 1045, y: 550, phase: 1, type: "city",
    hardiness: 30, desc: "加利利海滨重镇，主多次讲道医病之所。",
    connections: ["nazareth", "chorazin", "tiberias", "bethsaida"] // 修复：补充连向 bethsaida
  },
  "chorazin": {
    id: "chorazin", name: "哥拉汛", x: 1060, y: 535, phase: 1, type: "town",
    hardiness: 65, desc: "曾目睹诸多异能却依旧心硬之城。",
    connections: ["capernaum", "bethsaida"]
  },
  "bethsaida": {
    id: "bethsaida", name: "伯赛大", x: 1075, y: 545, phase: 1, type: "town",
    hardiness: 60, desc: "渔夫门徒的故乡，五饼二鱼奇迹发生地附近。",
    connections: ["chorazin", "capernaum"]
  },
  "nazareth": {
    id: "nazareth", name: "拿撒勒", x: 1025, y: 575, phase: 1, type: "town",
    hardiness: 50, desc: "加利利山间小镇，主幼年成长之地。",
    connections: ["capernaum", "samaria"]
  },
  "tiberias": {
    id: "tiberias", name: "提比哩亚", x: 1050, y: 565, phase: 1, type: "city",
    hardiness: 45, desc: "希律安提帕所建的希腊化城市。",
    connections: ["capernaum", "samaria"]
  },
  "samaria": {
    id: "samaria", name: "撒玛利亚", x: 1030, y: 620, phase: 1, type: "city",
    hardiness: 40, desc: "叙加雅各井旁，渴慕活水之地。行邪术的西门曾在此迷惑众人。",
    challenge: {
      title: "破除西门邪术迷思",
      desc: "行邪术的西门试图拿银子买圣灵恩赐。你需以真道严肃责备并呼召悔改！",
      reqTruth: 35, rewardConverts: 25, rewardFaith: 20
    },
    connections: ["nazareth", "tiberias", "jericho", "jerusalem"]
  },
  "jericho": {
    id: "jericho", name: "耶利哥", x: 1045, y: 660, phase: 1, type: "town",
    hardiness: 45, desc: "棕树之城，撒该蒙恩、巴底买重见光明之处。",
    connections: ["samaria", "jerusalem"]
  },
  "jerusalem": {
    id: "jerusalem", name: "耶路撒冷", x: 1025, y: 675, phase: 1, type: "hub",
    hardiness: 70, desc: "圣殿所在，受难、复活、圣灵降临的母会之源。",
    connections: ["samaria", "jericho", "joppa", "damascus", "antioch"]
  },
  "joppa": {
    id: "joppa", name: "约帕", x: 990, y: 655, phase: 1, type: "port",
    hardiness: 35, desc: "古老海港，硝皮匠西门居所，彼得见天布异象之地。",
    connections: ["jerusalem", "caesarea"]
  },
  "caesarea": {
    id: "caesarea", name: "凯撒利亚", x: 1005, y: 605, phase: 2, type: "port",
    hardiness: 55, desc: "罗马总督驻地，百夫长哥尼流归主之所。",
    connections: ["joppa", "antioch", "cyprus"]
  },
  "damascus": {
    id: "damascus", name: "大马士革", x: 1100, y: 505, phase: 2, type: "city",
    hardiness: 50, desc: "古叙利亚名邑，直街亚拿尼亚所住之地。",
    connections: ["jerusalem", "antioch"]
  },
  "antioch": {
    id: "antioch", name: "安提阿", x: 1060, y: 400, phase: 2, type: "hub",
    hardiness: 35, desc: "门徒被称为基督徒之始，向外邦宣教之总枢纽。",
    challenge: {
      title: "确立外邦宣教基地",
      desc: "巴拿巴与保罗在此同心牧养，差派门徒出征小亚细亚！",
      reqTruth: 45, rewardConverts: 35, rewardGoods: 40
    },
    connections: ["damascus", "tarsus", "cyprus", "caesarea", "jerusalem"] // 修复：补充连回 jerusalem
  },
  "cyprus": {
    id: "cyprus", name: "塞浦路斯", x: 955, y: 460, phase: 2, type: "port", isSea: true,
    hardiness: 45, desc: "地中海大岛，巴拿巴的故乡。",
    connections: ["antioch", "caesarea", "ephesus"]
  },
  "tarsus": {
    id: "tarsus", name: "大数", x: 990, y: 375, phase: 2, type: "city",
    hardiness: 40, desc: "基利家名城，学者名门云集。",
    connections: ["antioch", "iconium"]
  },
  "iconium": {
    id: "iconium", name: "以哥念", x: 900, y: 340, phase: 2, type: "town",
    hardiness: 55, desc: "小亚细亚内陆高原城镇，面临割礼规条纷争。",
    connections: ["tarsus", "ephesus"]
  },
  "ephesus": {
    id: "ephesus", name: "以弗所", x: 770, y: 360, phase: 2, type: "hub",
    hardiness: 65, desc: "亚细亚大都会，亚底米女神殿所在地，福音争战剧烈。",
    challenge: {
      title: "平息亚底米银匠暴乱",
      desc: "底米丢挑动全城工匠聚众反扑。需在推喇奴学房持续辨道，彰显真神伟大！",
      reqTruth: 70, rewardConverts: 45, rewardTruth: 30
    },
    connections: ["iconium", "cyprus", "athens", "philippi"]
  },
  "athens": {
    id: "athens", name: "雅典", x: 630, y: 410, phase: 2, type: "city",
    hardiness: 70, desc: "亚略巴古哲士聚集之都，敬拜未识之神。",
    challenge: {
      title: "亚略巴古哲理巅峰论辩",
      desc: "面对斯多亚与以彼古罗学派哲士，辨明创世主与死人复活之道！",
      reqTruth: 85, rewardConverts: 40, rewardTruth: 50
    },
    connections: ["ephesus", "thessalonica", "corinth"]
  },
  "corinth": {
    id: "corinth", name: "哥林多", x: 595, y: 430, phase: 2, type: "hub",
    hardiness: 60, desc: "商业与港口大都会，多元但也饱受世俗冲击。",
    challenge: {
      title: "化解教会世俗党争",
      desc: "教会内部因恩赐与分门别类产生危机，需以爱的至高之道使之归一！",
      reqTruth: 60, rewardConverts: 35, rewardFaith: 30
    },
    connections: ["athens", "thessalonica", "rome"]
  },
  "thessalonica": {
    id: "thessalonica", name: "帖撒罗尼迦", x: 625, y: 285, phase: 2, type: "city",
    hardiness: 55, desc: "马其顿重要港口，信徒信心爱心名声传开之地。",
    connections: ["philippi", "athens", "corinth"]
  },
  "philippi": {
    id: "philippi", name: "腓立比", x: 685, y: 260, phase: 2, type: "city",
    hardiness: 45, desc: "马其顿驻防重镇，吕底亚与狱卒一家归主之地。",
    connections: ["thessalonica", "ephesus"]
  },
  "rome": {
    id: "rome", name: "罗马城", x: 340, y: 275, phase: 2, type: "hub", isSea: true,
    hardiness: 80, desc: "帝国的心脏与尽头，福音在此放胆传扬，无人禁止。",
    connections: ["corinth"]
  }
};

// 3. 可招募的著名历史宣教同工库
const RECRUITABLE_COWORKERS = [
  {
    id: "barnabas",
    name: "劝慰子·巴拿巴",
    desc: "大有信心，被圣灵充满，善于劝勉激励众人，家产变卖周济使徒。",
    reqConverts: 30,
    costGoods: 25,
    perkDesc: "随队：全队传道胜率 +10% | 驻守：所在城市每回合提供 +4 物资"
  },
  {
    id: "timothy",
    name: "年轻同工·提摩太",
    desc: "路司得青年，真诚无伪之信，如儿子待父亲一般兴旺福音。",
    reqConverts: 60,
    costGoods: 30,
    perkDesc: "随队：行动力上限 +1 | 驻守：所在城市每回合刚硬度额外减少 1%"
  },
  {
    id: "lydia",
    name: "敬虔妇人·吕底亚",
    desc: "腓立比卖紫色布匹妇人，敬畏神，开放家庭作为全城聚会之所。",
    reqConverts: 90,
    costGoods: 40,
    perkDesc: "随队：建堂消耗减少 15 物资 | 驻守：所在城市提供每回合 +6 物资"
  },
  {
    id: "priscilla_aquila",
    name: "百基拉与亚居拉",
    desc: "织帐棚工匠同道，圣经真理熟稔，曾将主的道更详实指引给亚波罗。",
    reqConverts: 120,
    costGoods: 50,
    perkDesc: "随队：全队真理产出 +50% | 驻守：所在城市每回合提供 +3 真理"
  }
];

// 4. 双科技树定义
const TRUTH_TECH_TREE = [
  { id: "t_prophecy", name: "弥赛亚预言", cost: 20, desc: "融会贯通以赛亚书与诗篇，会堂辩道胜率 +15%" },
  { id: "t_grace", name: "因信称义", cost: 45, prereq: "t_prophecy", desc: "打破律法主义沉重枷锁，外邦人归信阻力 -25%" },
  { id: "t_one_body", name: "基督的身体", cost: 80, prereq: "t_grace", desc: "确立教会普世合一观，解锁跨城爱心周济网络" },
  { id: "t_gospel_canon", name: "福音书与使徒书信", cost: 130, prereq: "t_one_body", desc: "文字真理确立，书信远程增益效果与持续回合翻倍" }
];

const MINISTRY_TECH_TREE = [
  { id: "m_deacons", name: "执事治理分工", cost: 25, desc: "分担饭食与行政，教会内部埋怨减少，爱心物资储备 +30%" },
  { id: "m_elders", name: "按立各城长老", cost: 50, prereq: "m_deacons", desc: "即使无使徒驻守，已建教会也能抵御异端侵蚀" },
  { id: "m_epistles", name: "羊皮卷信差体制", cost: 75, prereq: "m_elders", desc: "解锁「书信督责」功能，可跨城发送书信维护教会" },
  { id: "m_world_mission", name: "差传宣教大会", cost: 120, prereq: "m_epistles", desc: "可自由招募提拔年轻同工，大地图移动力消耗减少" }
];

// 5. 历史危机事件库
const CRISIS_EVENTS = [
  {
    id: "c_sanhedrin",
    title: "犹太公会禁令与捉拿",
    desc: "公会的大祭司与差役下令严禁奉耶稣的名传道，并在城中四处搜捕！",
    requiredTech: "t_prophecy",
    onFailure: { faithLossPct: 0.15, convertsLossPct: 0.10 },
    successMsg: "门徒放胆引证摩西与先知书，官长无可奈何，只得恐吓释放！"
  },
  {
    id: "c_widows_neglect",
    title: "说希腊话寡妇的埋怨",
    desc: "说希腊话的犹太人向希伯来人发怨言，因在天天的供给上忽略了他们的寡妇！",
    requiredTech: "m_deacons",
    onFailure: { goodsLossPct: 0.20, convertsLossPct: 0.12 },
    successMsg: "选派七位大有信心被圣灵充满的执事料理此事，供给公平，教会大得和睦！"
  },
  {
    id: "c_herod_persecution",
    title: "希律王下手苦害教会",
    desc: "希律王用刀杀了约翰的哥哥雅各，见犹太人喜欢这事，又去捉拿使徒！全城震恐！",
    requiredTech: "t_prophecy",
    onFailure: { faithLossPct: 0.25, convertsLossPct: 0.15 },
    successMsg: "教会为受压制者切切祷告，圣灵显明大能使锁链脱落，逼迫反使福音更加广传！"
  },
  {
    id: "c_circumcision",
    title: "法利赛派割礼纷争",
    desc: "有几个人从犹太下来，坚持外邦信徒若不按规条受割礼就不能得救，教会大起争辩！",
    requiredTech: "t_grace",
    onFailure: { convertsLossPct: 0.20, truthLossPct: 0.15 },
    successMsg: "你力陈因信称义、靠主恩典得救的真道，化解了割礼纷争，教会大得坚固！"
  },
  {
    id: "c_philippi_prison",
    title: "官府毒打与禁卒监牢",
    desc: "因触犯外邦利益，使徒被撕开衣裳下在内监，两脚套上木狗！",
    requiredTech: "t_grace",
    onFailure: { faithLossPct: 0.20, goodsLossPct: 0.15 },
    successMsg: "夜半在监里祷告唱诗赞美神，地大震动，监门大开，连禁卒全家都悔改归主！"
  },
  {
    id: "c_areopagus_mockery",
    title: "雅典哲士的学术讥诮",
    desc: "斯多亚与以彼古罗学派哲士聚集亚略巴古，讥讽复活之道为无稽之谈！",
    requiredTech: "t_one_body",
    onFailure: { truthLossPct: 0.20, faithLossPct: 0.10 },
    successMsg: "阐明创造天地的主与未识之神，辩道无懈可击，数位议员当场悔改相信！"
  },
  {
    id: "c_false_teachers",
    title: "异端与假教师潜入",
    desc: "荒谬的异端学说在外邦各城私自引进来，迷惑根基未稳的初信者！",
    requiredTech: "m_elders",
    onFailure: { convertsLossPct: 0.25, faithLossPct: 0.15 },
    successMsg: "各城长老警醒守望，按正意分解真理的道，假教师羞愧败退！"
  },
  {
    id: "c_ephesus_riot",
    title: "以弗所银匠大骚乱",
    desc: "制造亚底米银龛的底米丢煽动全城工匠骚动，聚集喊叫，甚至拿住宣教同工！",
    requiredTech: "m_elders",
    onFailure: { goodsLossPct: 0.25, convertsLossPct: 0.15 },
    successMsg: "众长老处变不惊，书记官出面平息公愤，偶像虚妄暴露无遗，主道大大得胜！"
  },
  {
    id: "c_apostle_letter_crisis",
    title: "远方教会的分门别类",
    desc: "哥林多等城传来噩耗：教会内部分党结派，在世俗罪中松懈放纵！",
    requiredTech: "m_epistles",
    onFailure: { faithLossPct: 0.15, convertsLossPct: 0.18 },
    successMsg: "羊皮卷使徒书信及时送达，以基督十字架的大爱唤醒众人，重归圣洁合一！"
  },
  {
    id: "c_shipwreck_storm",
    title: "地中海狂风友拉革罗",
    desc: "宣教大船在海中遭遇十四昼夜狂风暴雨，太阳星辰不显露，得救指望都绝了！",
    requiredTech: "m_world_mission",
    onFailure: { goodsLossPct: 0.35, faithLossPct: 0.20 },
    successMsg: "使徒站起来宣告：‘神的使者昨夜站在我旁边说不要害怕！’全船二百余人无一丧命！"
  }
];