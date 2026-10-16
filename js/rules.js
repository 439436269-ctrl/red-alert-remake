/* ============================================================
 * RED ALERT · WEB REMAKE —— 游戏规则数据
 * 全部数值为自制平衡，非原作数据；单位造型与命名刻意避让商标。
 * ============================================================ */
'use strict';

const TILE = 32;              // 每格像素
const MAP_W = 72, MAP_H = 72; // 地图格数
const START_CASH = 6000;
const CASH_MAX = 99999;

const SIDE = {
  soviet: {
    name: 'SOVIET', cn: '苏联', color: '#e0453a', colorDk:'#8d2119',
    accent: '#ff6a58',
  },
  allied: {
    name: 'ALLIED', cn: '盟军', color: '#3f7fd8', colorDk:'#1d4a8f',
    accent: '#7fb6ff',
  },
};

/* ---------------- 建筑 ---------------- */
/* w/h 单位：格。power 正=发电 负=耗电。build 建造秒数（基础） */
const BUILDINGS = {
  hq:      { name:'建造场',     cn:'建造场',   w:4, h:4, hp:1500, cost:0,    build:0,   power:0,   req:null, key:'Q', tab:'struct', solo:true,
             desc:'战地核心。失去它将无法建造新建筑。' },
  reactor: { name:'反应堆',     cn:'反应堆',   w:2, h:2, hp:600,  cost:600,  build:6,   power:100, req:'hq', key:'W', tab:'struct',
             desc:'提供 100 电力。无电力时建筑与雷达停工。' },
  refinery:{ name:'矿石精炼厂', cn:'矿石精炼厂', w:3, h:3, hp:900,  cost:1400, build:10,  power:-30, req:'reactor', key:'E', tab:'struct',
             desc:'卸矿换取资金，附送一辆超时空采矿车。可建多座扩张经济。' },
  factory: { name:'战车工厂',   cn:'战车工厂', w:3, h:3, hp:1100, cost:1500, build:12,  power:-40, req:'refinery', key:'R', tab:'struct', solo:true,
             desc:'生产全部载具。' },
  barracks:{ name:'兵营',       cn:'兵营',     w:2, h:3, hp:700,  cost:500,  build:5,   power:-20, req:'reactor', key:'T', tab:'struct', solo:true,
             desc:'训练步兵单位。' },
  apower:  { name:'高级电站',   cn:'高级电站', w:2, h:2, hp:500,  cost:800,  build:8,   power:200, req:'reactor', key:'Y', tab:'struct',
             desc:'提供 200 电力，比反应堆更高效。' },
  defense: { name:'防御碉堡',   cn:'防御碉堡', w:2, h:2, hp:800,  cost:500,  build:8,   power:-15, req:'reactor', key:'U', tab:'struct',
             desc:'自动向来敌开火的机枪碉堡，克制步兵。' },
  tesla:   { name:'磁暴线圈',   cn:'磁暴线圈', w:2, h:2, hp:750,  cost:1200, build:12,  power:-30, req:'barracks', key:'I', tab:'struct', side:'soviet',
             desc:'高压电弧塔，对装甲目标伤害极高。' },
  prism:   { name:'光棱塔',     cn:'光棱塔',   w:2, h:2, hp:700,  cost:1200, build:12,  power:-30, req:'barracks', key:'I', tab:'struct', side:'allied',
             desc:'折射光束塔，射速快、射程远。' },
  silo:    { name:'物资仓库',   cn:'物资仓库', w:2, h:2, hp:500,  cost:800,  build:8,   power:-10, req:'refinery', key:'O', tab:'struct',
             desc:'无实际用途——但战报上很好看。（占位建筑，可不建）' },
};

/* ---------------- 单位 ---------------- */
/* speed: px/s   atk: 伤害  range: px  cooldown: 秒 */
const UNITS = {
  /* —— 步兵 —— */
  gi:      { name:'动员兵',   cn:'动员兵',   side:'soviet', tab:'inf', hp:120,  cost:200,  build:3.5, speed:46, atk:11, range:132, cool:0.9,  vsArmor:0.6,  key:'A', req:'barracks',
             desc:'廉价的基础步兵，成群才有威力。' },
  conscript:{name:'美国大兵', cn:'美国大兵', side:'allied', tab:'inf', hp:130,  cost:250,  build:4,   speed:48, atk:13, range:150, cool:1.0,  vsArmor:0.55, key:'A', req:'barracks',
             desc:'训练有素的常规步兵，射程略长。' },
  rocket:  { name:'火箭兵',   cn:'火箭兵',   side:'any',    tab:'inf', hp:100,  cost:300,  build:5,   speed:44, atk:26, range:210, cool:1.6,  vsArmor:1.6,  key:'S', req:'barracks',
             desc:'肩扛火箭筒，专打坦克与建筑。' },
  engineer:{ name:'工程师',   cn:'工程师',   side:'any',    tab:'inf', hp:80,   cost:500,  build:6,   speed:52, atk:0,   range:0,    cool:0,     vsArmor:1,    key:'D', req:'barracks', special:'cap',
             desc:'进入敌方建筑即可占领；进入己方受损建筑立即修复满。' },

  /* —— 载具 —— */
  harvester:{name:'超时空采矿车', cn:'超时空采矿车', side:'any', tab:'veh', hp:600, cost:1400, build:10, speed:56, atk:0, range:0, cool:0, vsArmor:1, key:'Z', req:'refinery', special:'harvest',
             desc:'往返矿脉与精炼厂运矿。可多买几辆加速采矿。' },
  buggy:   { name:'狂风坦克', cn:'狂风坦克', side:'soviet', tab:'veh', hp:420, cost:700,  build:7,   speed:74,  atk:24, range:150, cool:1.1,  vsArmor:1.0,  key:'X', req:'factory',
             desc:'轻型突击坦克，便宜、跑得快。' },
  lighttank:{name:'灰熊坦克', cn:'灰熊坦克', side:'allied', tab:'veh', hp:440, cost:800,  build:7.5, speed:76,  atk:26, range:155, cool:1.1,  vsArmor:1.0,  key:'X', req:'factory',
             desc:'轻型主战坦克，机动性优秀。' },
  heavytank:{ name:'犀牛坦克', cn:'犀牛坦克', side:'soviet', tab:'veh', hp:700, cost:1100, build:10,  speed:56,  atk:44, range:170, cool:1.5,  vsArmor:1.15, key:'C', req:'factory',
             desc:'厚甲重炮，正面推进的中坚。' },
  mastiff: { name:'守护者坦克', cn:'守护者坦克', side:'allied', tab:'veh', hp:660, cost:1200, build:10, speed:60, atk:40, range:185, cool:1.4,  vsArmor:1.1,  key:'C', req:'factory',
             desc:'均衡的主战坦克，射程占优。' },
  v2:      { name:'V3 火箭车', cn:'V3 火箭车', side:'soviet', tab:'veh', hp:300, cost:1000, build:10, speed:48, atk:95, range:430, cool:5.0,  vsArmor:1.0,  splash:56, key:'V', req:'factory', artillery:true,
             desc:'远程火箭打击，可轰塌建筑；近身毫无还手之力。' },
  ifv:     { name:'多功能步兵车', cn:'多功能步兵车', side:'allied', tab:'veh', hp:320, cost:900, build:9, speed:88, atk:30, range:230, cool:0.8, vsArmor:0.9,  key:'V', req:'factory',
             desc:'高射速防空车，放风筝利器。' },
  arv:     { name:'装甲运兵车', cn:'装甲运兵车', side:'any', tab:'veh', hp:520, cost:600, build:7, speed:70, atk:8, range:120, cool:1.0, vsArmor:0.4, key:'B', req:'factory',
             desc:'便宜的移动火力点，吸收伤害的肉盾。' },
};

/* 矿区 */
const ORE_VALUE = 30;          // 单块矿石价值
const ORE_LOAD = 8;            // 单车载矿量(块)

/* 防御建筑武器 */
const DEF_WEAPON = {
  defense: { atk:16, range:240, cool:0.55, vsArmor:0.5, type:'bullet' },
  tesla:   { atk:60, range:250, cool:2.2,  vsArmor:1.4, type:'tesla' },
  prism:   { atk:48, range:280, cool:1.6,  vsArmor:1.2, type:'beam' },
};

/* 特殊能力 */
const SPECIALS = {
  nuke: { name:'核弹', cd:120, build:25, reqPower:120, desc:'在任意可见位置投放核弹。需 120 电力盈余与 25 秒充能。' },
  sat:  { name:'间谍卫星', cd:75,  build:12, reqPower:80,  desc:'揭开全图迷雾 45 秒。需 80 电力盈余。' },
};

/* 需要的科技树（建筑前置），用于 UI 显示 */
const TECH_ORDER = ['hq','reactor','refinery','barracks','factory'];

/* 提示文案 */
const TIPS = {
  noPower:   '电力不足！生产与防御武器停摆——快造反应堆。',
  noCash:    '资金不足。',
  needBarracks:'需要先建造兵营。',
  needFactory:'需要先建造战车工厂。',
  needRefinery:'需要先建造矿石精炼厂。',
  needReactor:'需要先建造反应堆。',
  needHQ:    '失去建造场，无法建造新建筑！',
  structureSold:'建筑已出售，返还 50% 资金。',
  unitLost:  '我方单位损失！',
  baseAttacked:'基地遭到攻击！',
  lowPower:  '电力接近临界。',
};
