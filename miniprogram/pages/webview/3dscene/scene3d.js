var threejsModule = require('./lib/threejs-miniprogram/index')
var createScopedThreejs = threejsModule.createScopedThreejs
var registerGLTFLoader = require('./lib/registerGLTFLoader')
var createPanelData = require('./lib/devicePanelBinding').createPanelData
var createAssetPathCandidates = require('./lib/assetPathCandidates').createAssetPathCandidates

var db = wx.cloud.database()

var INSTRUMENT_CONFIG = {
  smallIncubator: {
    name: '智能生化培养箱',
    description: '用于细胞培养和微生物培养的精密设备，提供稳定的温度、湿度和气体环境。',
    specs: ['温度范围: 4℃ - 60℃', '容积: 150L', '控温精度: ±0.1℃', '湿度范围: 50% - 95% RH'],
    operations: ['打开电源开关，等待设备自检完成', '通过控制面板设置目标温度和湿度', '放入培养物品并关闭箱门', '定期检查运行状态和参数记录'],
    applications: ['细胞培养', '微生物发酵', '种子发芽实验', '酶活性研究']
  },
  largeIncubator: {
    name: '大型智能生化培养箱',
    description: '大容量智能生化培养箱，适用于大批量样品培养，具备多段程序控制和远程监控功能。',
    specs: ['温度范围: 0℃ - 80℃', '容积: 500L', '控温精度: ±0.05℃', '湿度范围: 20% - 98% RH', 'CO2控制: 0-20%'],
    operations: ['确认设备供电正常，打开主电源', '通过触摸屏设置多段培养程序', '使用扫码枪记录样品信息', '设置报警参数和远程监控', '定期清洁和校准传感器'],
    applications: ['大规模细胞培养', '组织工程', '生物制药', '疫苗研发']
  },
  floorCentrifuge: {
    name: '落地式高速冷冻离心机',
    description: '大容量高速冷冻离心机，具备精确温度控制和多种转子选择，适用于大规模样品处理。',
    specs: ['最高转速: 20000 rpm', '最大离心力: 45000 ×g', '温度范围: -20℃ - 40℃', '容量: 6×1000mL / 12×500mL', '制冷系统: 压缩机制冷', '噪音水平: <65 dB'],
    operations: ['检查电源连接和接地', '预冷离心腔至设定温度', '选择合适的转子和适配器', '平衡对称位置的样品', '设置转速、温度和时间参数', '关闭安全锁并启动运行', '等待完全停止后取出样品'],
    applications: ['大规模细胞培养收集', '蛋白纯化', '血液成分分离', '病毒浓缩', '生物制品制备']
  },
  tocvAnalyzer: {
    name: 'TOC-VCPH总有机碳分析仪',
    description: '高性能总有机碳分析仪，采用680℃催化燃烧氧化法，具备高精度和高灵敏度分析能力。',
    specs: ['测量范围: 0.001mg/L - 30,000mg/L', '分析原理: 680℃催化燃烧氧化法', '检测器: 非分散红外检测器(NDIR)', '分析时间: 约4分钟/样品', '重现性: RSD≤1.5%'],
    operations: ['打开主机电源和自动进样器电源', '启动TOC控制软件', '设置分析方法和参数', '准备标准曲线和质控样品', '放置样品并开始分析', '定期清洗燃烧管和更换试剂'],
    applications: ['纯化水系统验证', '制药用水监测', '环境水质分析', '工业废水检测', '实验室超纯水质量控制']
  },
  elementarTOC: {
    name: 'Elementar TOC分析仪',
    description: '德国Elementar公司生产的高性能总有机碳分析仪，采用高温催化氧化法，具备高精度和稳定性。',
    specs: ['测量范围: 0.001mg/L - 30,000mg/L', '分析原理: 680℃高温催化氧化', '检测器: NDIR非分散红外检测器', '分析时间: 3-6分钟/样品', '重现性: RSD≤1%', '样品量: 0.1-2.0mL'],
    operations: ['打开主机和计算机电源', '启动TOC控制软件', '预热检测器至工作温度', '准备标准曲线和质控样品', '设置分析参数和样品序列', '开始自动分析并监控数据', '保存数据并生成报告'],
    applications: ['制药用水监测', '环境水质分析', '工业过程控制', '实验室纯水系统验证', '废水处理监测']
  },
  ls13320: {
    name: 'LS 13 320激光粒度分析仪',
    description: '高性能激光粒度分析仪，采用先进的激光衍射技术，能够快速准确地分析各种样品的粒度分布。',
    specs: ['测量范围: 0.04 - 2000 μm', '测量原理: 激光衍射技术', '重复性: < 1% RSD', '测量时间: < 60秒', '光源: 632.8nm氦氖激光器', '检测器: 92个检测单元'],
    operations: ['打开仪器电源和计算机', '启动LS 13 320控制软件', '选择适当的测量方法和参数', '准备样品并进行分散处理', '开始自动测量和分析', '保存数据并生成报告'],
    applications: ['制药行业颗粒分析', '化工原料粒度控制', '食品粉末特性分析', '矿物加工质量控制', '科研材料表征']
  }
}

var DEVICE_3D_MAP = {
  'INCUBATOR_SMALL_1': { name: '智能生化培养箱', configKey: 'smallIncubator', pos: [2.65, 0, -4.65], rotation: 0 },
  'INCUBATOR_SMALL_2': { name: '智能生化培养箱', configKey: 'smallIncubator', pos: [1.75, 0, -4.65], rotation: 0 },
  'INCUBATOR_SMALL_3': { name: '智能生化培养箱', configKey: 'smallIncubator', pos: [0.85, 0, -4.65], rotation: 0 },
  'INCUBATOR_SMALL_4': { name: '智能生化培养箱', configKey: 'smallIncubator', pos: [-0.05, 0, -4.65], rotation: 0 },
  'INCUBATOR_LARGE_1': { name: '大型智能生化培养箱', configKey: 'largeIncubator', dbDeviceId: 'PUBLIC_LAB1_LARGE_001', pos: [-2.15, 0, -4.55], rotation: 0 },
  'INCUBATOR_LARGE_2': { name: '大型智能生化培养箱', configKey: 'largeIncubator', dbDeviceId: 'PUBLIC_LAB1_LARGE_002', pos: [-3.35, 0, -4.55], rotation: 0 },
  'INCUBATOR_LARGE_3': { name: '大型智能生化培养箱', configKey: 'largeIncubator', dbDeviceId: 'PUBLIC_LAB1_LARGE_003', pos: [-4.55, 0, 4.55], rotation: Math.PI / 2 },
  'INCUBATOR_LARGE_4': { name: '大型智能生化培养箱', configKey: 'largeIncubator', dbDeviceId: 'PUBLIC_LAB1_LARGE_004', pos: [-4.55, 0, 2.55], rotation: Math.PI / 2 },
  'INCUBATOR_LARGE_5': { name: '大型智能生化培养箱', configKey: 'largeIncubator', dbDeviceId: 'PUBLIC_LAB1_LARGE_005', pos: [-4.55, 0, 0.55], rotation: Math.PI / 2 },
  'INCUBATOR_LARGE_6': { name: '大型智能生化培养箱', configKey: 'largeIncubator', dbDeviceId: 'PUBLIC_LAB1_LARGE_006', pos: [-4.55, 0, -1.45], rotation: Math.PI / 2 },
  'TOC_ELEMENTAR_001': { name: 'Elementar TOC分析仪', configKey: 'elementarTOC', dbDeviceId: 'PUBLIC_LAB1_LARGE_010', pos: [-2.6, 0.7, -1.3], rotation: 0, frontColor: 0x003366 },
  'TOC_ELEMENTAR_002': { name: 'Elementar TOC分析仪', configKey: 'elementarTOC', dbDeviceId: 'PUBLIC_LAB1_LARGE_011', pos: [2.6, 0.7, -1.3], rotation: 0, frontColor: 0x808080 },
  'TOC_ELEMENTAR_003': { name: 'Elementar TOC分析仪', configKey: 'elementarTOC', dbDeviceId: 'PUBLIC_LAB1_LARGE_012', pos: [-0.5, 0.7, 2.6], rotation: 0, frontColor: 0x660000 },
  'PUBLIC_LAB1_LARGE_007': { name: '落地式高速冷冻离心机', configKey: 'floorCentrifuge', pos: [3.9, 0.0125, 0], rotation: 0 },
  'PUBLIC_LAB1_LARGE_008': { name: 'TOC-VCPH总有机碳分析仪', configKey: 'tocvAnalyzer', pos: [-1.5, 0.7, -2.9], rotation: -Math.PI / 2 },
  'PUBLIC_LAB1_LARGE_009': { name: 'TOC-VCPH总有机碳分析仪', configKey: 'tocvAnalyzer', pos: [0.1, 0.7, -2.9], rotation: -Math.PI / 2 },
  'PUBLIC_LAB1_LARGE_013': { name: 'LS 13 320激光粒度分析仪', configKey: 'ls13320', pos: [-0.5, 0.7, 1.2], rotation: -Math.PI / 2 }
}

var ROOM_SIZE = { WIDTH: 10, HEIGHT: 3, DEPTH: 10 }
var TABLE_SIZE = { LENGTH: 6, HEIGHT: 0.7, WIDTH: 2 }

var COLORS = {
  FLOOR: 0x888888,
  WALL: 0xFFFFFF,
  CEILING: 0xFAFAFA,
  DOOR_FRAME: 0x808080,
  DOOR: 0x808080,
  WINDOW_FRAME: 0x333333,
  WINDOW_GLASS: 0x87CEEB,
  TABLE: 0x1A3A2A,
  SHELF_METAL: 0xC0C0C0,
  INCUBATOR_BODY: 0xC0C0C0,
  INCUBATOR_DOOR: 0x3399FF,
  INCUBATOR_PANEL: 0x004499,
  INCUBATOR_WINDOW: 0x66AAFF,
  CENTRIFUGE_BODY: 0xF0F0F0,
  CENTRIFUGE_PANEL: 0x404040,
  TOC_BODY: 0xFFFFFF,
  TOC_PANEL: 0x333333,
  BACKGROUND: 0x0A192F
}

var EXTERNAL_MODEL_ASSETS = {
  floorCentrifuge: '/pages/webview/3dscene/assets/models/Centrifuge.glb',
  tocvAnalyzer: '/pages/webview/3dscene/assets/models/ShimadzuTOC.glb',
  ls13320: '/pages/webview/3dscene/assets/models/LS13320.glb'
}

Page({
  data: {
    isLoading: true,
    loadingProgress: 0,
    focusHint: '',
    panelOpen: false,
    role: 'student',
    panelData: {
      name: '',
      deviceId: '',
      lab: '',
      model: '',
      description: '',
      status: 'available',
      statusText: '可用',
      canViewDetail: false,
      canReserve: false
    }
  },

  onLoad: function(options) {
    this.targetDeviceId = options.device_id || ''
    this.role = options.role || 'student'
    this.setData({ role: this.role })
    this.devicesFromDb = []
    this.touchStartPos = null
    this.touchStartTime = 0
    this.isDragging = false
    this.deviceMeshes = {}
    this.pinching = false
    this.lastPinchDist = 0
  },

  onReady: function() {
    this.initScene()
  },

  requestNextFrame: function(callback) {
    if (this.canvas && typeof this.canvas.requestAnimationFrame === 'function') {
      return this.canvas.requestAnimationFrame(callback)
    }
    return setTimeout(callback, 16)
  },

  cancelNextFrame: function(frameId) {
    if (!frameId) return

    if (this.canvas && typeof this.canvas.cancelAnimationFrame === 'function') {
      this.canvas.cancelAnimationFrame(frameId)
      return
    }

    clearTimeout(frameId)
  },

  createLabelMesh: function(THREE, text, y) {
    if (!text || typeof wx === 'undefined' || typeof wx.createOffscreenCanvas !== 'function') {
      return null
    }

    var labelCanvas = wx.createOffscreenCanvas({ type: '2d', width: 256, height: 64 })
    if (!labelCanvas || typeof labelCanvas.getContext !== 'function') {
      return null
    }

    var ctx = labelCanvas.getContext('2d')
    if (!ctx) {
      return null
    }

    ctx.fillStyle = 'rgba(0,0,0,0.6)'
    ctx.fillRect(0, 0, 256, 64)
    ctx.fillStyle = '#ffffff'
    ctx.font = 'bold 20px sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, 128, 32)

    var labelTexture = new THREE.CanvasTexture(labelCanvas)
    var label = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 0.25),
      new THREE.MeshBasicMaterial({ map: labelTexture, transparent: true })
    )
    label.position.set(0, y, 0)
    return label
  },

  getWindowMetrics: function() {
    if (typeof wx !== 'undefined') {
      if (typeof wx.getWindowInfo === 'function') {
        return wx.getWindowInfo()
      }
      if (typeof wx.getSystemInfoSync === 'function') {
        return wx.getSystemInfoSync()
      }
    }

    return {
      pixelRatio: 1,
      windowWidth: 1,
      windowHeight: 1
    }
  },

  getCanvasMetrics: function() {
    var windowInfo = this.getWindowMetrics()
    var rect = this.canvasRect || {}
    var pixelRatio = windowInfo.pixelRatio || 1
    var width = rect.width || (this.canvas && this.canvas.width ? this.canvas.width / pixelRatio : 0) || windowInfo.windowWidth || 1
    var height = rect.height || (this.canvas && this.canvas.height ? this.canvas.height / pixelRatio : 0) || windowInfo.windowHeight || 1

    return {
      left: rect.left || 0,
      top: rect.top || 0,
      width: width,
      height: height,
      pixelRatio: pixelRatio
    }
  },

  getTouchPoint: function(touch) {
    if (!touch) return null

    return {
      x: typeof touch.pageX === 'number' ? touch.pageX : (typeof touch.clientX === 'number' ? touch.clientX : (typeof touch.x === 'number' ? touch.x : 0)),
      y: typeof touch.pageY === 'number' ? touch.pageY : (typeof touch.clientY === 'number' ? touch.clientY : (typeof touch.y === 'number' ? touch.y : 0))
    }
  },

  getTouchDistance: function(firstTouch, secondTouch) {
    var first = this.getTouchPoint(firstTouch)
    var second = this.getTouchPoint(secondTouch)
    if (!first || !second) return 0

    var dx = first.x - second.x
    var dy = first.y - second.y
    return Math.sqrt(dx * dx + dy * dy)
  },

  onUnload: function() {
    if (this.renderer && typeof this.renderer.dispose === 'function') {
      this.renderer.dispose()
    }
    if (this.rafId) {
      this.cancelNextFrame(this.rafId)
      this.rafId = null
    }
  },

  initScene: function() {
    var self = this
    var query = wx.createSelectorQuery()
    query.select('#webgl-canvas').fields({ node: true, size: true }).exec(function(res) {
      if (!res || !res[0] || !res[0].node) {
        wx.showToast({ title: 'Canvas 初始化失败', icon: 'none' })
        return
      }

      var canvas = res[0].node
      var THREE = createScopedThreejs(canvas)
      self.ensureGLTFLoader(THREE)
      self.THREE = THREE
      self.canvas = canvas

      self.canvasRect = {
        left: typeof res[0].left === 'number' ? res[0].left : 0,
        top: typeof res[0].top === 'number' ? res[0].top : 0,
        width: res[0].width,
        height: res[0].height
      }

      var windowInfo = self.getWindowMetrics()
      var dpr = windowInfo.pixelRatio || 1
      var width = res[0].width || windowInfo.windowWidth || 1
      var height = res[0].height || windowInfo.windowHeight || 1
      canvas.width = width * dpr
      canvas.height = height * dpr

      var scene = new THREE.Scene()
      scene.background = new THREE.Color(COLORS.BACKGROUND)
      self.scene = scene

      var camera = new THREE.PerspectiveCamera(55, width / height, 0.01, 1000)
      camera.position.set(0, 2, 10)
      self.camera = camera
      self.cameraTarget = new THREE.Vector3(0, 0, 0)

      var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true })
      renderer.setSize(width, height)
      renderer.setPixelRatio(Math.min(dpr, 2))
      renderer.shadowMap.enabled = true
      renderer.shadowMap.type = THREE.PCFSoftShadowMap
      self.renderer = renderer

      self.setData({ loadingProgress: 10 })

      self.initLights(THREE, scene)
      self.setData({ loadingProgress: 20 })

      self.buildRoom(THREE, scene)
      self.setData({ loadingProgress: 35 })

      self.buildFurniture(THREE, scene)
      self.setData({ loadingProgress: 50 })

      self.loadDevicesFromDb(function() {
        var completeSceneReady = function() {
          self.setData({ loadingProgress: 90, isLoading: false })

          if (self.targetDeviceId) {
            setTimeout(function() {
              self.focusOnDevice(self.targetDeviceId)
            }, 500)
          }

          self.startRenderLoop()
        }

        self.buildAllInstruments(THREE, scene)
          .then(completeSceneReady)
          .catch(function(error) {
            console.error('3D仪器加载失败:', error)
            completeSceneReady()
          })
      })
    })
  },

  initLights: function(THREE, scene) {
    var ambient = new THREE.AmbientLight(0xffffff, 0.5)
    scene.add(ambient)

    var dirLight = new THREE.DirectionalLight(0xffffff, 0.6)
    dirLight.position.set(3, 8, 5)
    dirLight.castShadow = true
    dirLight.shadow.mapSize.width = 2048
    dirLight.shadow.mapSize.height = 2048
    dirLight.shadow.camera.near = 0.5
    dirLight.shadow.camera.far = 50
    dirLight.shadow.camera.left = -8
    dirLight.shadow.camera.right = 8
    dirLight.shadow.camera.top = 8
    dirLight.shadow.camera.bottom = -8
    scene.add(dirLight)

    var backLight = new THREE.DirectionalLight(0xccddff, 0.4)
    backLight.position.set(-2, 5, -6)
    scene.add(backLight)

    var fillLight = new THREE.DirectionalLight(0xccddff, 0.3)
    fillLight.position.set(-4, 3, -2)
    scene.add(fillLight)

    var ceilingPositions = [
      [-3.64, 2.9, -3.64], [0, 2.9, -3.64], [3.64, 2.9, -3.64],
      [-3.64, 2.9, 0], [0, 2.9, 0], [3.64, 2.9, 0],
      [-3.64, 2.9, 3.64], [0, 2.9, 3.64], [3.64, 2.9, 3.64]
    ]
    var self = this
    ceilingPositions.forEach(function(pos) {
      var pointLight = new THREE.PointLight(0xFFFFFF, 0.4, 8)
      pointLight.position.set(pos[0], pos[1] - 0.1, pos[2])
      scene.add(pointLight)

      var lightGeo = new THREE.PlaneGeometry(0.9, 0.9)
      var lightMat = new THREE.MeshBasicMaterial({ color: 0xFFFFFF, transparent: true, opacity: 0.8 })
      var lightMesh = new THREE.Mesh(lightGeo, lightMat)
      lightMesh.position.set(pos[0], pos[1], pos[2])
      lightMesh.rotation.x = -Math.PI / 2
      scene.add(lightMesh)
    })
  },

  buildRoom: function(THREE, scene) {
    var W = ROOM_SIZE.WIDTH, H = ROOM_SIZE.HEIGHT, D = ROOM_SIZE.DEPTH

    var floorMat = new THREE.MeshStandardMaterial({ color: COLORS.FLOOR, roughness: 0.8 })
    var floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), floorMat)
    floor.rotation.x = -Math.PI / 2
    floor.receiveShadow = true
    scene.add(floor)

    var gridHelper = new THREE.GridHelper(W, 10, 0x444444, 0x444444)
    gridHelper.position.y = 0.01
    scene.add(gridHelper)

    var wallMat = new THREE.MeshStandardMaterial({ color: COLORS.WALL, roughness: 0.7 })

    var backWall = new THREE.Mesh(new THREE.PlaneGeometry(W, H), wallMat)
    backWall.position.set(0, H / 2, -D / 2)
    backWall.receiveShadow = true
    scene.add(backWall)

    var leftWall = new THREE.Mesh(new THREE.PlaneGeometry(D, H), wallMat)
    leftWall.position.set(-W / 2, H / 2, 0)
    leftWall.rotation.y = Math.PI / 2
    leftWall.receiveShadow = true
    scene.add(leftWall)

    var rightWall = new THREE.Mesh(new THREE.PlaneGeometry(D, H), wallMat)
    rightWall.position.set(W / 2, H / 2, 0)
    rightWall.rotation.y = -Math.PI / 2
    rightWall.receiveShadow = true
    scene.add(rightWall)

    var ceilingMat = new THREE.MeshStandardMaterial({ color: COLORS.CEILING, roughness: 0.9 })
    var ceiling = new THREE.Mesh(new THREE.PlaneGeometry(W, D), ceilingMat)
    ceiling.position.set(0, H, 0)
    ceiling.rotation.x = Math.PI / 2
    ceiling.receiveShadow = true
    scene.add(ceiling)

    var ceilingGrid = new THREE.GridHelper(W, 11, 0xCCCCCC, 0xCCCCCC)
    ceilingGrid.position.y = H - 0.01
    scene.add(ceilingGrid)

    this.buildWindows(THREE, scene)
    this.buildDoor(THREE, scene)
  },

  buildWindows: function(THREE, scene) {
    var windowMat = new THREE.MeshStandardMaterial({ color: COLORS.WINDOW_GLASS, transparent: true, opacity: 0.3 })
    var frameMat = new THREE.MeshStandardMaterial({ color: COLORS.WINDOW_FRAME })

    for (var i = 0; i < 4; i++) {
      var windowMesh = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.6), windowMat)
      windowMesh.position.set(-4.99, 1.8, -3 + i * 2)
      windowMesh.rotation.y = Math.PI / 2
      scene.add(windowMesh)

      var frame = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 1.8), frameMat)
      frame.position.set(-4.98, 1.8, -3 + i * 2)
      frame.rotation.y = Math.PI / 2
      scene.add(frame)
    }
  },

  buildDoor: function(THREE, scene) {
    var doorFrameMat = new THREE.MeshStandardMaterial({ color: COLORS.DOOR_FRAME })
    var doorMat = new THREE.MeshStandardMaterial({ color: COLORS.DOOR })

    var doorFrame = new THREE.Mesh(new THREE.BoxGeometry(1.2, 2.1, 0.1), doorFrameMat)
    doorFrame.position.set(4.95, 1.05, -4.4)
    doorFrame.rotation.y = -Math.PI / 2
    scene.add(doorFrame)

    var door = new THREE.Mesh(new THREE.BoxGeometry(1.1, 2.0, 0.04), doorMat)
    door.position.set(4.95, 1.0, -4.4)
    door.rotation.y = -Math.PI / 2
    scene.add(door)

    var handleMat = new THREE.MeshStandardMaterial({ color: 0xCCCCCC, metalness: 0.8 })
    var handle = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.1, 16), handleMat)
    handle.position.set(4.92, 1.2, -4.0)
    handle.rotation.z = Math.PI / 2
    scene.add(handle)
  },

  buildFurniture: function(THREE, scene) {
    var tableMat = new THREE.MeshStandardMaterial({ color: COLORS.TABLE, roughness: 0.9 })

    var frontTable = new THREE.Mesh(new THREE.BoxGeometry(TABLE_SIZE.LENGTH, TABLE_SIZE.HEIGHT, TABLE_SIZE.WIDTH), tableMat)
    frontTable.position.set(0, TABLE_SIZE.HEIGHT / 2, -2)
    frontTable.castShadow = true
    frontTable.receiveShadow = true
    scene.add(frontTable)

    var backTable = new THREE.Mesh(new THREE.BoxGeometry(TABLE_SIZE.LENGTH, TABLE_SIZE.HEIGHT, TABLE_SIZE.WIDTH), tableMat)
    backTable.position.set(0, TABLE_SIZE.HEIGHT / 2, 2)
    backTable.castShadow = true
    backTable.receiveShadow = true
    scene.add(backTable)

    this.buildReagentShelves(THREE, scene)
  },

  buildReagentShelves: function(THREE, scene) {
    var self = this
    var zPositions = [-2, 2]
    zPositions.forEach(function(zPos) {
      self.buildSingleShelf(THREE, scene, zPos)
    })
  },

  buildSingleShelf: function(THREE, scene, zPosition) {
    var shelfGroup = new THREE.Group()
    var material = new THREE.MeshStandardMaterial({ color: COLORS.SHELF_METAL, roughness: 0.7, metalness: 0.8 })

    var totalLength = 5.2
    var totalHeight = 1.0
    var pillarSize = 0.1

    var pillarGeo = new THREE.BoxGeometry(pillarSize, totalHeight, pillarSize)
    var leftPillar = new THREE.Mesh(pillarGeo, material)
    var rightPillar = new THREE.Mesh(pillarGeo, material)
    leftPillar.position.set(-totalLength / 2 + pillarSize / 2, totalHeight / 2, 0)
    rightPillar.position.set(totalLength / 2 - pillarSize / 2, totalHeight / 2, 0)
    shelfGroup.add(leftPillar)
    shelfGroup.add(rightPillar)

    var shelfHeights = [totalHeight * 0.3, totalHeight * 0.7]
    var shelfDepth = 0.2
    var shelfThickness = 0.02
    var tiltAngle = Math.PI / 12

    var self = this
    shelfHeights.forEach(function(height) {
      self.buildShelfWithBar(THREE, shelfGroup, totalLength, shelfDepth, shelfThickness, height, tiltAngle, material, shelfDepth / 2)
      self.buildShelfWithBar(THREE, shelfGroup, totalLength, shelfDepth, shelfThickness, height, -tiltAngle, material, -shelfDepth / 2)
    })

    shelfGroup.position.set(0.4, TABLE_SIZE.HEIGHT, zPosition)
    shelfGroup.traverse(function(child) {
      if (child.isMesh) {
        child.castShadow = true
        child.receiveShadow = true
      }
    })

    scene.add(shelfGroup)
  },

  buildShelfWithBar: function(THREE, group, length, depth, thickness, height, tiltAngle, material, zPos) {
    var shelf = new THREE.Mesh(new THREE.BoxGeometry(length - 0.1, thickness, depth), material)
    shelf.rotation.x = tiltAngle
    shelf.position.set(0, height, zPos)
    group.add(shelf)

    var bar = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, length - 0.1, 8), material)
    bar.rotation.z = Math.PI / 2
    var barY = height + Math.abs((depth / 2 + 0.01) * Math.sin(tiltAngle))
    var barZ = zPos > 0
      ? zPos + (depth / 2 + 0.01) * Math.cos(tiltAngle)
      : zPos - (depth / 2 + 0.01) * Math.cos(tiltAngle)
    bar.position.set(0, barY, barZ)
    group.add(bar)
  },

  loadDevicesFromDb: function(callback) {
    var self = this
    db.collection('devices')
      .where({ lab_type: 'public', lab_name: '公共实验室1' })
      .limit(50)
      .get()
      .then(function(res) {
        self.devicesFromDb = res.data || []
        callback()
      })
      .catch(function() {
        callback()
      })
  },

  resolveDbDeviceId: function(deviceId) {
    var sceneDeviceId = String(deviceId || '').trim()
    var mapInfo = DEVICE_3D_MAP[sceneDeviceId]
    return mapInfo && mapInfo.dbDeviceId ? mapInfo.dbDeviceId : sceneDeviceId
  },

  getDeviceStatus: function(deviceId) {
    var dbDeviceId = this.resolveDbDeviceId(deviceId)
    for (var i = 0; i < this.devicesFromDb.length; i++) {
      if (this.devicesFromDb[i].device_id === dbDeviceId) {
        return this.devicesFromDb[i].status || 'available'
      }
    }
    return 'available'
  },

  getDeviceInfo: function(deviceId) {
    var dbDeviceId = this.resolveDbDeviceId(deviceId)
    for (var i = 0; i < this.devicesFromDb.length; i++) {
      if (this.devicesFromDb[i].device_id === dbDeviceId) {
        return this.devicesFromDb[i]
      }
    }
    return null
  },

  getDeviceModel: function(deviceInfo) {
    var specs = (deviceInfo && deviceInfo.specifications) || {}
    if (specs && typeof specs === 'object') {
      return String(specs['型号'] || specs['鍨嬪彿'] || specs.model || (deviceInfo && deviceInfo.model) || '').trim()
    }
    return String((deviceInfo && deviceInfo.model) || '').trim()
  },

  buildGroupKey: function(deviceInfo) {
    if (!deviceInfo) return ''
    return [
      String(deviceInfo.device_name || ''),
      String(deviceInfo.lab_name || ''),
      String(deviceInfo.device_type || ''),
      this.getDeviceModel(deviceInfo)
    ].join('||')
  },

  summarizeText: function(text, maxLength) {
    var value = String(text || '').trim()
    if (!value) return ''
    if (value.length <= maxLength) return value
    return value.slice(0, maxLength) + '...'
  },

  getHitObjectDisplayName: function(hitObject) {
    var current = hitObject
    while (current && !(current.userData && current.userData.clickable)) {
      var name = String((current.userData && current.userData.name) || current.name || '').trim()
      if (name) {
        return name
      }
      current = current.parent
    }
    return ''
  },

  buildStudentDetailUrl: function(deviceId) {
    var dbDeviceId = this.resolveDbDeviceId(deviceId)
    if (!dbDeviceId) return ''
    return '/pages/device/detail/devicedetail?deviceId=' + encodeURIComponent(dbDeviceId)
  },

  buildAdminDetailUrl: function(deviceInfo) {
    if (!deviceInfo) return ''

    var deviceName = String(deviceInfo.device_name || '').trim()
    var labName = String(deviceInfo.lab_name || '').trim()
    var deviceType = String(deviceInfo.device_type || '').trim()
    var model = this.getDeviceModel(deviceInfo)
    var groupKey = this.buildGroupKey(deviceInfo)

    if (!deviceName || !labName || !deviceType) {
      return ''
    }

    return '/pages/admin/device-detail/admindevicedetail?deviceName=' + encodeURIComponent(deviceName)
      + '&labName=' + encodeURIComponent(labName)
      + '&deviceType=' + encodeURIComponent(deviceType)
      + '&model=' + encodeURIComponent(model)
      + '&groupKey=' + encodeURIComponent(groupKey)
  },

  ensureGLTFLoader: function(THREE) {
    if (!THREE || typeof THREE.GLTFLoader === 'function') {
      return
    }

    registerGLTFLoader(THREE)
  },

  getExternalModelAssetPath: function(configKey) {
    return EXTERNAL_MODEL_ASSETS[configKey] || ''
  },

  getExternalModelAssetCandidates: function(configKey) {
    var assetPath = this.getExternalModelAssetPath(configKey)
    return createAssetPathCandidates(assetPath)
  },

  prepareLoadedInstrumentModel: function(model) {
    if (!model || typeof model.traverse !== 'function') {
      return model
    }

    model.traverse(function(child) {
      if (!child.isMesh) return

      child.castShadow = true
      child.receiveShadow = true

      if (child.material) {
        if (typeof child.material.roughness === 'number') {
          child.material.roughness = 0.5
        }
        if (typeof child.material.metalness === 'number') {
          child.material.metalness = 0.2
        }
        child.material.needsUpdate = true
      }
    })

    return model
  },

  loadExternalInstrumentModel: function(THREE, configKey) {
    var self = this
    var assetCandidates = this.getExternalModelAssetCandidates(configKey)

    if (!assetCandidates.length) {
      return Promise.reject(new Error('Missing external model asset path for ' + configKey))
    }

    this.ensureGLTFLoader(THREE)
    if (typeof THREE.GLTFLoader !== 'function') {
      return Promise.reject(new Error('GLTFLoader is unavailable in mini program scope'))
    }

    return new Promise(function(resolve, reject) {
      var loader = new THREE.GLTFLoader()

      var tryLoad = function(index, lastError) {
        if (index >= assetCandidates.length) {
          reject(lastError || new Error('Failed to load model: ' + configKey))
          return
        }

        var assetPath = assetCandidates[index]
        var resourcePath = assetPath.slice(0, assetPath.lastIndexOf('/') + 1)

        wx.getFileSystemManager().readFile({
          filePath: assetPath,
          success: function(result) {
            loader.parse(
              result.data,
              resourcePath,
              function(gltf) {
                var model = (gltf && (gltf.scene || (gltf.scenes && gltf.scenes[0]))) || null
                if (!model) {
                  tryLoad(index + 1, new Error('Loaded glTF does not contain a scene: ' + assetPath))
                  return
                }

                resolve(self.prepareLoadedInstrumentModel(model))
              },
              function(error) {
                tryLoad(index + 1, error || new Error('Failed to parse model: ' + assetPath))
              }
            )
          },
          fail: function(error) {
            tryLoad(index + 1, error || new Error('Failed to read model file: ' + assetPath))
          }
        })
      }

      tryLoad(0, null)
    })
  },

  createFallbackInstrument: function(THREE, deviceId, configKey) {
    if (configKey === 'floorCentrifuge') {
      return this.createFloorCentrifuge(THREE, deviceId)
    }
    if (configKey === 'tocvAnalyzer') {
      return this.createShimadzuTOC(THREE, deviceId)
    }
    if (configKey === 'ls13320') {
      return this.createLS13320(THREE, deviceId)
    }
    return null
  },

  createInstrumentGroup: function(THREE, deviceId, mapInfo) {
    var self = this

    if (!mapInfo) {
      return Promise.resolve(null)
    }

    if (mapInfo.configKey === 'smallIncubator') {
      return Promise.resolve(self.createSmallIncubator(THREE, deviceId))
    }
    if (mapInfo.configKey === 'largeIncubator') {
      return Promise.resolve(self.createLargeIncubator(THREE, deviceId))
    }
    if (mapInfo.configKey === 'elementarTOC') {
      return Promise.resolve(self.createElementarTOC(THREE, deviceId, mapInfo.frontColor || 0xD0D0D0))
    }
    if (mapInfo.configKey === 'floorCentrifuge' || mapInfo.configKey === 'tocvAnalyzer' || mapInfo.configKey === 'ls13320') {
      return self.loadExternalInstrumentModel(THREE, mapInfo.configKey)
        .catch(function(error) {
          console.warn('外部模型加载失败，回退到简化模型:', mapInfo.configKey, error)
          return self.createFallbackInstrument(THREE, deviceId, mapInfo.configKey)
        })
    }

    return Promise.resolve(null)
  },

  buildAllInstruments: function(THREE, scene) {
    var self = this
    var keys = Object.keys(DEVICE_3D_MAP)
    var tasks = keys.map(function(id) {
      var mapInfo = DEVICE_3D_MAP[id]

      return self.createInstrumentGroup(THREE, id, mapInfo)
        .then(function(group) {
          if (!group) return

          group.position.set(mapInfo.pos[0], mapInfo.pos[1], mapInfo.pos[2])
          if (mapInfo.rotation) {
            group.rotation.y = mapInfo.rotation
          }

          var status = self.getDeviceStatus(id)
          self.addStatusBorder(THREE, group, status)

          group.userData = Object.assign({}, group.userData, { deviceId: id, clickable: true })
          scene.add(group)
          self.deviceMeshes[id] = group
        })
    })

    return Promise.all(tasks)
  },

  getLabelHeight: function(configKey) {
    var heights = {
      smallIncubator: 1.45,
      largeIncubator: 1.75,
      elementarTOC: 0.85,
      floorCentrifuge: 1.55,
      tocvAnalyzer: 0.85,
      ls13320: 0.95
    }
    return heights[configKey] || 1.0
  },

  getInverseMatrix: function(THREE, matrix) {
    var inverseMatrix = new THREE.Matrix4()
    if (typeof inverseMatrix.copy === 'function') {
      inverseMatrix.copy(matrix)
    }
    if (typeof inverseMatrix.invert === 'function') {
      inverseMatrix.invert()
      return inverseMatrix
    }
    if (typeof inverseMatrix.getInverse === 'function') {
      inverseMatrix.getInverse(matrix)
      return inverseMatrix
    }
    return inverseMatrix
  },

  getGroupLocalBoundingBox: function(THREE, group) {
    if (!group || typeof group.traverse !== 'function') {
      return null
    }

    if (typeof group.updateMatrixWorld === 'function') {
      group.updateMatrixWorld(true)
    }

    var inverseMatrix = this.getInverseMatrix(THREE, group.matrixWorld)
    var localBox = new THREE.Box3()
    var hasBox = false

    group.traverse(function(child) {
      if (!child || !child.isMesh || (child.userData && child.userData.isStatusBorder)) {
        return
      }

      var childBox = new THREE.Box3().setFromObject(child)
      childBox.applyMatrix4(inverseMatrix)
      if (hasBox) {
        localBox.union(childBox)
      } else if (typeof localBox.copy === 'function') {
        localBox.copy(childBox)
      } else {
        localBox.min.copy(childBox.min)
        localBox.max.copy(childBox.max)
      }
      hasBox = true
    })

    return hasBox ? localBox : null
  },

  addStatusBorder: function(THREE, group, status) {
    var colorMap = {
      available: 0x00ff00,
      using: 0xff9800,
      maintenance: 0xf44336
    }
    var borderColor = colorMap[status] || 0xffffff

    var bbox = this.getGroupLocalBoundingBox(THREE, group)
    if (!bbox) return

    var size = new THREE.Vector3()
    bbox.getSize(size)
    var center = new THREE.Vector3()
    bbox.getCenter(center)
    if (!size.x || !size.y || !size.z) return

    var wireGeo = new THREE.BoxGeometry(size.x + 0.05, size.y + 0.05, size.z + 0.05)
    var wireMat = new THREE.MeshBasicMaterial({ color: borderColor, wireframe: true, transparent: true, opacity: 0.6 })
    var wireframe = new THREE.Mesh(wireGeo, wireMat)
    wireframe.position.copy(center)
    wireframe.userData.isStatusBorder = true
    group.add(wireframe)
  },

  createSmallIncubator: function(THREE, deviceId) {
    var group = new THREE.Group()
    var width = 0.7, depth = 0.7, height = 1.2

    var mainBody = new THREE.Mesh(
      new THREE.BoxGeometry(width, height, depth),
      new THREE.MeshStandardMaterial({ color: COLORS.INCUBATOR_BODY, roughness: 0.5, metalness: 0.1 })
    )
    mainBody.position.y = height / 2
    mainBody.castShadow = true
    mainBody.receiveShadow = true
    group.add(mainBody)

    var door = new THREE.Mesh(
      new THREE.BoxGeometry(width * 0.8, height * 0.8, depth * 0.05),
      new THREE.MeshStandardMaterial({ color: COLORS.INCUBATOR_DOOR, roughness: 0.5, metalness: 0.1 })
    )
    door.position.set(0, height * 0.5, depth / 2 + 0.025)
    group.add(door)

    var controlPanel = new THREE.Mesh(
      new THREE.BoxGeometry(width * 0.6, height * 0.08, depth * 0.1),
      new THREE.MeshStandardMaterial({ color: COLORS.INCUBATOR_PANEL, roughness: 0.5, metalness: 0.1 })
    )
    controlPanel.position.set(0, height * 0.9, depth / 2 + 0.05)
    group.add(controlPanel)

    var windowPanel = new THREE.Mesh(
      new THREE.BoxGeometry(width * 0.5, height * 0.4, depth * 0.08),
      new THREE.MeshStandardMaterial({ color: COLORS.INCUBATOR_WINDOW, transparent: true, opacity: 0.7, roughness: 0.3 })
    )
    windowPanel.position.set(0, height * 0.5, depth / 2 + 0.04)
    group.add(windowPanel)

    return group
  },

  createLargeIncubator: function(THREE, deviceId) {
    var group = new THREE.Group()
    var width = 0.9, depth = 0.9, height = 1.5

    var mainBody = new THREE.Mesh(
      new THREE.BoxGeometry(width, height, depth),
      new THREE.MeshStandardMaterial({ color: COLORS.INCUBATOR_BODY, roughness: 0.5, metalness: 0.1 })
    )
    mainBody.position.y = height / 2
    mainBody.castShadow = true
    mainBody.receiveShadow = true
    group.add(mainBody)

    var door = new THREE.Mesh(
      new THREE.BoxGeometry(width * 0.8, height * 0.8, depth * 0.05),
      new THREE.MeshStandardMaterial({ color: COLORS.INCUBATOR_DOOR, roughness: 0.5, metalness: 0.1 })
    )
    door.position.set(0, height * 0.5, depth / 2 + 0.025)
    group.add(door)

    var controlPanel = new THREE.Mesh(
      new THREE.BoxGeometry(width * 0.6, height * 0.08, depth * 0.1),
      new THREE.MeshStandardMaterial({ color: COLORS.INCUBATOR_PANEL, roughness: 0.5, metalness: 0.1 })
    )
    controlPanel.position.set(0, height * 0.9, depth / 2 + 0.05)
    group.add(controlPanel)

    var windowPanel = new THREE.Mesh(
      new THREE.BoxGeometry(width * 0.5, height * 0.4, depth * 0.08),
      new THREE.MeshStandardMaterial({ color: COLORS.INCUBATOR_WINDOW, transparent: true, opacity: 0.7, roughness: 0.3 })
    )
    windowPanel.position.set(0, height * 0.5, depth / 2 + 0.04)
    group.add(windowPanel)

    var vent = new THREE.Mesh(
      new THREE.BoxGeometry(width * 0.7, height * 0.05, depth * 0.06),
      new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.5, metalness: 0.1 })
    )
    vent.position.set(0, height * 0.75, depth / 2 + 0.04)
    group.add(vent)

    return group
  },

  createElementarTOC: function(THREE, deviceId, frontColor) {
    var group = new THREE.Group()
    var width = 0.65, height = 0.6, depth = 0.6

    var mainBody = new THREE.Mesh(
      new THREE.BoxGeometry(width, height, depth),
      new THREE.MeshStandardMaterial({ color: 0xE8E8E8, roughness: 0.5, metalness: 0.1 })
    )
    mainBody.position.y = height / 2
    mainBody.castShadow = true
    mainBody.receiveShadow = true
    group.add(mainBody)

    var frontPanel = new THREE.Mesh(
      new THREE.BoxGeometry(width * 0.95, height * 0.9, depth * 0.05),
      new THREE.MeshStandardMaterial({ color: frontColor, roughness: 0.5, metalness: 0.1 })
    )
    frontPanel.position.set(0, height * 0.45, depth / 2 + 0.015)
    group.add(frontPanel)

    var blackStrip = new THREE.Mesh(
      new THREE.BoxGeometry(width * 0.9, height * 0.1, depth * 0.02),
      new THREE.MeshStandardMaterial({ color: 0x101010, roughness: 0.5, metalness: 0.1 })
    )
    blackStrip.position.set(0, height * 0.85, depth / 2 + 0.036)
    group.add(blackStrip)

    var logo = new THREE.Mesh(
      new THREE.BoxGeometry(width * 0.2, height * 0.04, depth * 0.02),
      new THREE.MeshStandardMaterial({ color: 0xFFFFFF, roughness: 0.5, metalness: 0.1 })
    )
    logo.position.set(0, height * 0.85, depth / 2 + 0.048)
    group.add(logo)

    var leftSide = new THREE.Mesh(
      new THREE.BoxGeometry(width * 0.05, height * 0.3, depth * 0.4),
      new THREE.MeshStandardMaterial({ color: 0x909090, roughness: 0.5, metalness: 0.1 })
    )
    leftSide.position.set(-width * 0.475, height * 0.15, 0)
    group.add(leftSide)

    var rightSide = new THREE.Mesh(
      new THREE.BoxGeometry(width * 0.05, height * 0.3, depth * 0.4),
      new THREE.MeshStandardMaterial({ color: 0x909090, roughness: 0.5, metalness: 0.1 })
    )
    rightSide.position.set(width * 0.475, height * 0.15, 0)
    group.add(rightSide)

    return group
  },

  createFloorCentrifuge: function(THREE, deviceId) {
    var group = new THREE.Group()

    var baseWidth = 0.8, baseDepth = 0.8, baseHeight = 0.15
    var base = new THREE.Mesh(
      new THREE.BoxGeometry(baseWidth, baseHeight, baseDepth),
      new THREE.MeshStandardMaterial({ color: COLORS.CENTRIFUGE_BODY, roughness: 0.5, metalness: 0.1 })
    )
    base.position.y = baseHeight / 2
    base.castShadow = true
    base.receiveShadow = true
    group.add(base)

    var bodyWidth = 0.7, bodyDepth = 0.7, bodyHeight = 1.0
    var body = new THREE.Mesh(
      new THREE.BoxGeometry(bodyWidth, bodyHeight, bodyDepth),
      new THREE.MeshStandardMaterial({ color: COLORS.CENTRIFUGE_BODY, roughness: 0.5, metalness: 0.1 })
    )
    body.position.y = baseHeight + bodyHeight / 2
    body.castShadow = true
    body.receiveShadow = true
    group.add(body)

    var lidRadius = 0.3, lidHeight = 0.08
    var lid = new THREE.Mesh(
      new THREE.CylinderGeometry(lidRadius, lidRadius, lidHeight, 32),
      new THREE.MeshStandardMaterial({ color: COLORS.CENTRIFUGE_PANEL, roughness: 0.5, metalness: 0.2 })
    )
    lid.position.y = baseHeight + bodyHeight + lidHeight / 2
    group.add(lid)

    var panelWidth = 0.3, panelHeight = 0.2, panelDepth = 0.05
    var panel = new THREE.Mesh(
      new THREE.BoxGeometry(panelWidth, panelHeight, panelDepth),
      new THREE.MeshStandardMaterial({ color: 0x003366, emissive: 0x001a33, emissiveIntensity: 0.3, roughness: 0.3 })
    )
    panel.position.set(0, baseHeight + bodyHeight * 0.7, bodyDepth / 2 + panelDepth / 2)
    group.add(panel)

    var handleGeo = new THREE.CylinderGeometry(0.015, 0.015, 0.12, 8)
    var handleMat = new THREE.MeshStandardMaterial({ color: 0xCCCCCC, metalness: 0.8 })
    var handle = new THREE.Mesh(handleGeo, handleMat)
    handle.position.set(0, baseHeight + bodyHeight + lidHeight / 2 + 0.02, lidRadius + 0.02)
    handle.rotation.x = Math.PI / 2
    group.add(handle)

    return group
  },

  createShimadzuTOC: function(THREE, deviceId) {
    var group = new THREE.Group()
    var width = 0.7, height = 0.55, depth = 0.55

    var mainBody = new THREE.Mesh(
      new THREE.BoxGeometry(width, height, depth),
      new THREE.MeshStandardMaterial({ color: COLORS.TOC_BODY, roughness: 0.5, metalness: 0.1 })
    )
    mainBody.position.y = height / 2
    mainBody.castShadow = true
    mainBody.receiveShadow = true
    group.add(mainBody)

    var topUnit = new THREE.Mesh(
      new THREE.BoxGeometry(width * 0.8, height * 0.3, depth * 0.8),
      new THREE.MeshStandardMaterial({ color: 0xE0E0E0, roughness: 0.5, metalness: 0.1 })
    )
    topUnit.position.y = height + height * 0.15
    topUnit.castShadow = true
    group.add(topUnit)

    var screen = new THREE.Mesh(
      new THREE.PlaneGeometry(width * 0.5, height * 0.35),
      new THREE.MeshStandardMaterial({ color: 0x004488, emissive: 0x002244, emissiveIntensity: 0.3, roughness: 0.3 })
    )
    screen.position.set(0, height * 0.65, depth / 2 + 0.01)
    group.add(screen)

    var panel = new THREE.Mesh(
      new THREE.BoxGeometry(width * 0.8, height * 0.1, depth * 0.03),
      new THREE.MeshStandardMaterial({ color: COLORS.TOC_PANEL, roughness: 0.5, metalness: 0.1 })
    )
    panel.position.set(0, height * 0.25, depth / 2 + 0.015)
    group.add(panel)

    var samplePort = new THREE.Mesh(
      new THREE.CylinderGeometry(0.02, 0.02, 0.03, 16),
      new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.8 })
    )
    samplePort.position.set(width * 0.2, height * 0.4, depth / 2 + 0.015)
    group.add(samplePort)

    return group
  },

  createLS13320: function(THREE, deviceId) {
    var group = new THREE.Group()
    var width = 0.8, height = 0.5, depth = 0.6

    var mainBody = new THREE.Mesh(
      new THREE.BoxGeometry(width, height, depth),
      new THREE.MeshStandardMaterial({ color: 0xF0F0F0, roughness: 0.5, metalness: 0.1 })
    )
    mainBody.position.y = height / 2
    mainBody.castShadow = true
    mainBody.receiveShadow = true
    group.add(mainBody)

    var laserUnit = new THREE.Mesh(
      new THREE.BoxGeometry(width * 0.4, height * 0.5, depth * 0.9),
      new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.5, metalness: 0.2 })
    )
    laserUnit.position.set(-width * 0.25, height + height * 0.25, 0)
    laserUnit.castShadow = true
    group.add(laserUnit)

    var screen = new THREE.Mesh(
      new THREE.PlaneGeometry(width * 0.45, height * 0.35),
      new THREE.MeshStandardMaterial({ color: 0x003366, emissive: 0x001a33, emissiveIntensity: 0.3, roughness: 0.3 })
    )
    screen.position.set(width * 0.15, height * 0.65, depth / 2 + 0.01)
    group.add(screen)

    var sampleChamber = new THREE.Mesh(
      new THREE.BoxGeometry(width * 0.25, height * 0.3, depth * 0.3),
      new THREE.MeshStandardMaterial({ color: 0xAAAAAA, transparent: true, opacity: 0.6, roughness: 0.3 })
    )
    sampleChamber.position.set(width * 0.2, height + height * 0.15, depth * 0.2)
    group.add(sampleChamber)

    var vent = new THREE.Mesh(
      new THREE.BoxGeometry(width * 0.3, height * 0.05, depth * 0.03),
      new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.5 })
    )
    vent.position.set(0, height * 0.9, depth / 2 + 0.015)
    group.add(vent)

    return group
  },

  startRenderLoop: function() {
    var self = this
    function loop() {
      self.rafId = self.requestNextFrame(loop)
      self.updateCamera()
      self.renderer.render(self.scene, self.camera)
    }
    loop()
  },

  updateCamera: function() {
    if (this.cameraAnimating && this.cameraAnimTarget) {
      var t = 0.08
      this.camera.position.lerp(this.cameraAnimTarget, t)
      this.cameraTarget.lerp(this.cameraAnimLookAt, t)
      this.camera.lookAt(this.cameraTarget)

      var dist = this.camera.position.distanceTo(this.cameraAnimTarget)
      if (dist < 0.05) {
        this.cameraAnimating = false
      }
    }
  },

  focusOnDevice: function(deviceId, displayName) {
    var mesh = this.deviceMeshes[deviceId]
    if (!mesh) return

    var THREE = this.THREE
    var pos = mesh.position
    this.cameraAnimTarget = new THREE.Vector3(pos.x + 2, pos.y + 1.5, pos.z + 2)
    this.cameraAnimLookAt = new THREE.Vector3(pos.x, pos.y, pos.z)
    this.cameraAnimating = true

    var mapInfo = DEVICE_3D_MAP[deviceId]
    var focusName = String(displayName || (mapInfo && mapInfo.name) || '').trim()
    if (focusName) {
      this.setData({ focusHint: '已聚焦：' + focusName })
      var self = this
      setTimeout(function() { self.setData({ focusHint: '' }) }, 2500)
    }
  },

  onTouchStart: function(e) {
    if (!e.touches || e.touches.length === 0) return

    if (e.touches.length === 2) {
      this.pinching = true
      this.lastPinchDist = this.getTouchDistance(e.touches[0], e.touches[1])
      return
    }

    var touch = this.getTouchPoint(e.touches[0])
    if (!touch) return

    this.touchStartPos = touch
    this.touchStartTime = Date.now()
    this.isDragging = false

    if (e.touches.length === 1) {
      this.lastTouch = touch
    }
  },

  onTouchMove: function(e) {
    if (!e.touches || e.touches.length === 0) return

    if (this.pinching && e.touches.length === 2) {
      var dist = this.getTouchDistance(e.touches[0], e.touches[1])
      if (this.lastPinchDist > 0) {
        var scale = dist / this.lastPinchDist
        var radius = Math.sqrt(
          Math.pow(this.camera.position.x - this.cameraTarget.x, 2) +
          Math.pow(this.camera.position.z - this.cameraTarget.z, 2)
        )
        radius = Math.max(3, Math.min(25, radius / scale))
        var angle = Math.atan2(this.camera.position.z - this.cameraTarget.z, this.camera.position.x - this.cameraTarget.x)
        this.camera.position.x = this.cameraTarget.x + radius * Math.cos(angle)
        this.camera.position.z = this.cameraTarget.z + radius * Math.sin(angle)
        this.camera.lookAt(this.cameraTarget)
      }
      this.lastPinchDist = dist
      return
    }

    var touch = this.getTouchPoint(e.touches[0])
    if (!touch) return

    if (this.touchStartPos) {
      var ddx = touch.x - this.touchStartPos.x
      var ddy = touch.y - this.touchStartPos.y
      if (Math.abs(ddx) > 5 || Math.abs(ddy) > 5) {
        this.isDragging = true
      }
    }

    if (e.touches.length === 1 && this.lastTouch) {
      var deltaX = (touch.x - this.lastTouch.x) * 0.01
      var deltaY = (touch.y - this.lastTouch.y) * 0.01

      var angle = Math.atan2(this.camera.position.z - this.cameraTarget.z, this.camera.position.x - this.cameraTarget.x)
      angle -= deltaX

      var radius = Math.sqrt(
        Math.pow(this.camera.position.x - this.cameraTarget.x, 2) +
        Math.pow(this.camera.position.z - this.cameraTarget.z, 2)
      )

      this.camera.position.x = this.cameraTarget.x + radius * Math.cos(angle)
      this.camera.position.z = this.cameraTarget.z + radius * Math.sin(angle)
      this.camera.position.y = Math.max(0.5, Math.min(5, this.camera.position.y - deltaY * 2))
      this.camera.lookAt(this.cameraTarget)

      this.lastTouch = touch
    }
  },

  onTouchEnd: function(e) {
    if (this.pinching) {
      this.pinching = false
      this.lastPinchDist = 0
      return
    }

    if (!this.isDragging && this.touchStartPos) {
      var elapsed = Date.now() - this.touchStartTime
      if (elapsed < 300) {
        this.handleTap(this.touchStartPos.x, this.touchStartPos.y)
      }
    }
    this.touchStartPos = null
    this.lastTouch = null
  },

  handleTap: function(x, y) {
    var THREE = this.THREE
    if (!THREE) return

    var canvasMetrics = this.getCanvasMetrics()
    if (canvasMetrics.width <= 0 || canvasMetrics.height <= 0) return

    var localX = x - canvasMetrics.left
    var localY = y - canvasMetrics.top
    var mouse = new THREE.Vector2(
      (localX / canvasMetrics.width) * 2 - 1,
      -(localY / canvasMetrics.height) * 2 + 1
    )

    var raycaster = new THREE.Raycaster()
    raycaster.setFromCamera(mouse, this.camera)

    var allMeshes = []
    var self = this
    Object.keys(this.deviceMeshes).forEach(function(id) {
      var group = self.deviceMeshes[id]
      group.traverse(function(child) {
        if (child.isMesh && !child.userData.isStatusBorder) allMeshes.push(child)
      })
    })

    var intersects = raycaster.intersectObjects(allMeshes, false)
    if (intersects.length > 0) {
      var obj = intersects[0].object
      var group = obj.parent
      while (group && !group.userData.clickable) {
        group = group.parent
      }
      if (group && group.userData.deviceId) {
        this.onDeviceClick(group.userData.deviceId, obj)
      }
    } else {
      if (this.data.panelOpen) {
        this.setData({ panelOpen: false })
      }
    }
  },

  onDeviceClick: function(deviceId, hitObject) {
    this.selectedDeviceId = deviceId
    this.selectedHitObjectName = this.getHitObjectDisplayName(hitObject)
    this.showDeviceInfo(deviceId, hitObject)
    this.focusOnDevice(deviceId, this.selectedHitObjectName)
  },

  showDeviceInfo: function(deviceId, hitObject) {
    var self = this
    var mapInfo = DEVICE_3D_MAP[deviceId]
    var configKey = mapInfo ? mapInfo.configKey : ''
    var config = INSTRUMENT_CONFIG[configKey] || {}
    var dbDeviceId = this.resolveDbDeviceId(deviceId)
    var dbInfo = this.getDeviceInfo(deviceId)
    var status = this.getDeviceStatus(deviceId)
    var statusText = status === 'using' ? '使用中' : (status === 'maintenance' ? '维修中' : '可用')
    var model = this.getDeviceModel(dbInfo)
    var detailUrl = this.role === 'student'
      ? this.buildStudentDetailUrl(deviceId)
      : this.buildAdminDetailUrl(dbInfo)
    var hitObjectName = typeof hitObject === 'string'
      ? String(hitObject || '').trim()
      : this.getHitObjectDisplayName(hitObject)
    var panelData = createPanelData({
      hitObjectName: hitObjectName,
      dbInfo: dbInfo,
      dbDeviceId: dbDeviceId,
      model: model,
      status: status,
      statusText: statusText,
      detailUrl: detailUrl,
      configName: config.name,
      configDescription: config.description,
      mapName: mapInfo && mapInfo.name,
      role: this.role,
      fallbackDescription: '暂无描述',
      fallbackLabText: '公共实验室1',
      unknownName: '未知仪器',
      summarizeText: function(text) {
        return self.summarizeText(text, 44)
      }
    })

    this.setData({
      panelOpen: true,
      panelData: panelData
    })
  },

  closePanel: function() {
    this.setData({ panelOpen: false })
  },

  goToDeviceDetail: function() {
    if (!this.selectedDeviceId) return

    var url = ''
    if (this.role === 'student') {
      url = this.buildStudentDetailUrl(this.selectedDeviceId)
    } else {
      url = this.buildAdminDetailUrl(this.getDeviceInfo(this.selectedDeviceId))
    }

    if (!url) {
      wx.showToast({
        title: '当前仪器暂无详情数据',
        icon: 'none'
      })
      return
    }

    wx.navigateTo({
      url: url,
      fail: function(err) {
        console.error('跳转仪器详情失败:', err)
        wx.showToast({
          title: '加载失败',
          icon: 'none'
        })
      }
    })
  },

  goToReserve: function() {
    if (!this.selectedDeviceId) return
    wx.navigateTo({
      url: '/pages/reservation/reservation?device_id=' + this.selectedDeviceId
    })
  },

  goBack: function() {
    wx.navigateBack()
  }
})
