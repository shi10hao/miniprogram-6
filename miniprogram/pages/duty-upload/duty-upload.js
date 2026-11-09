// 安全员打卡：上传本次值日的现场照片与情况说明
const MAX_IMAGES = 3
const MAX_REMARK_LENGTH = 200
const MAX_LAB_NAME_LENGTH = 30
const MAX_NAME_LENGTH = 20
const PHONE_PATTERN = /^1[3-9]\d{9}$/
const CLOUD_DIR = 'duty_records'
const IMAGE_EXT_PATTERN = /\.(jpe?g|png|webp|gif)$/i
// 校验失败的提示按这个顺序取第一条，保证先提示最上面的问题
const FIELD_ORDER = ['labName', 'name', 'phone', 'images', 'remark']

/**
 * 从临时文件路径里取扩展名，拿不到或不在白名单时按 jpg 存
 */
function pickImageExt(filePath) {
  const matched = IMAGE_EXT_PATTERN.exec(String(filePath || ''))
  return matched ? matched[1].toLowerCase().replace('jpeg', 'jpg') : 'jpg'
}

Page({
  data: {
    dutyInfo: {
      labName: '',
      name: '',
      phone: '',
      remark: '',
      images: []
    },
    maxImages: MAX_IMAGES,
    maxRemarkLength: MAX_REMARK_LENGTH,
    canAddImage: true,
    isSubmitting: false,
    // 逐字段的错误提示，够用且不用弹窗打断
    errors: {}
  },

  // ==================== 生命周期 ====================
  onUnload() {
    if (this.backTimer) clearTimeout(this.backTimer)
  },

  // 打卡表单没有远端数据，下拉不清空已填内容，只收起刷新动画
  onPullDownRefresh() {
    wx.stopPullDownRefresh()
  },

  // ==================== 输入监听 ====================
  /**
   * 所有输入框共用：靠 data-field 决定写哪个字段
   */
  onInput(e) {
    const field = e.currentTarget.dataset.field
    if (!field) return

    const patch = { ['dutyInfo.' + field]: e.detail.value }
    // 用户重新输入就把该字段的报错清掉
    if (this.data.errors[field]) patch['errors.' + field] = ''

    this.setData(patch)
  },

  // ==================== 业务动作 ====================
  onChooseImage() {
    const images = this.data.dutyInfo.images
    const remaining = MAX_IMAGES - images.length
    if (remaining <= 0) {
      wx.showToast({ title: `最多上传 ${MAX_IMAGES} 张照片`, icon: 'none' })
      return
    }

    wx.chooseMedia({
      count: remaining,
      mediaType: ['image'],
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const paths = (res.tempFiles || []).map(item => item.tempFilePath).filter(Boolean)
        if (!paths.length) return

        const nextImages = this.data.dutyInfo.images.concat(paths).slice(0, MAX_IMAGES)
        this.setData({
          'dutyInfo.images': nextImages,
          canAddImage: nextImages.length < MAX_IMAGES,
          'errors.images': ''
        })
      },
      fail: (err) => {
        // 用户自己取消不算失败
        if (String((err && err.errMsg) || '').indexOf('cancel') > -1) return
        console.error('[duty-upload] 选择照片失败', err)
        wx.showToast({ title: '选择照片失败', icon: 'none' })
      }
    })
  },

  onRemoveImage(e) {
    const index = Number(e.currentTarget.dataset.index)
    const nextImages = this.data.dutyInfo.images.filter((item, i) => i !== index)

    this.setData({
      'dutyInfo.images': nextImages,
      canAddImage: nextImages.length < MAX_IMAGES
    })
  },

  onPreviewImage(e) {
    const index = Number(e.currentTarget.dataset.index)
    const urls = this.data.dutyInfo.images
    if (!urls[index]) return

    wx.previewImage({ current: urls[index], urls })
  },

  /**
   * 提交：先传图、再写库；写库失败会把已传的图删掉，不留孤儿文件
   */
  async onSubmit() {
    if (this.data.isSubmitting) return

    const userInfo = wx.getStorageSync('userInfo') || {}
    if (!userInfo.userId) {
      wx.showToast({ title: '请先登录后再打卡', icon: 'none' })
      return
    }

    const errors = this.buildErrors()
    if (Object.keys(errors).length) {
      const firstField = FIELD_ORDER.find(field => errors[field])
      this.setData({ errors })
      wx.showToast({ title: errors[firstField] || '请检查填写内容', icon: 'none' })
      return
    }

    this.setData({ isSubmitting: true })
    wx.showLoading({ title: '提交中...', mask: true })

    let fileIds = []
    try {
      fileIds = await this.uploadImages()
      await this.saveDutyRecord(fileIds)

      wx.hideLoading()
      wx.showToast({ title: '提交成功', icon: 'success' })
      this.resetForm()

      this.backTimer = setTimeout(() => {
        if (getCurrentPages().length > 1) wx.navigateBack()
      }, 900)
    } catch (err) {
      wx.hideLoading()
      console.error('[duty-upload] 提交打卡失败', err)
      wx.showToast({ title: '提交失败，请重试', icon: 'none' })
      this.removeCloudFiles(fileIds)
    } finally {
      this.setData({ isSubmitting: false })
    }
  },

  // ==================== 加工 ====================
  /**
   * 逐字段校验，返回 { 字段名: 提示 }，没问题时返回空对象
   */
  buildErrors() {
    const { labName, name, phone, remark, images } = this.data.dutyInfo
    const errors = {}

    if (!labName.trim()) errors.labName = '请填写实验室名称'
    if (!name.trim()) errors.name = '请填写值日人员姓名'
    if (!PHONE_PATTERN.test(phone.trim())) errors.phone = '请填写正确的 11 位手机号'
    if (!images.length) errors.images = '请至少上传 1 张现场照片'
    if (remark.trim().length > MAX_REMARK_LENGTH) {
      errors.remark = `情况说明最多 ${MAX_REMARK_LENGTH} 字`
    }

    return errors
  },

  /**
   * 逐张上传，任何一张失败就先把已传成功的删掉再抛错
   */
  async uploadImages() {
    const images = this.data.dutyInfo.images
    const fileIds = []
    const stamp = Date.now()

    for (let i = 0; i < images.length; i++) {
      wx.showLoading({ title: `上传照片 ${i + 1}/${images.length}`, mask: true })
      try {
        const res = await wx.cloud.uploadFile({
          cloudPath: `${CLOUD_DIR}/duty_${stamp}_${i}.${pickImageExt(images[i])}`,
          filePath: images[i]
        })
        fileIds.push(res.fileID)
      } catch (err) {
        this.removeCloudFiles(fileIds)
        throw err
      }
    }

    return fileIds
  },

  saveDutyRecord(imageFileIds) {
    const db = wx.cloud.database()
    const userInfo = wx.getStorageSync('userInfo') || {}
    const { labName, name, phone, remark } = this.data.dutyInfo

    return db.collection('duty_records').add({
      data: {
        lab_name: labName.trim().slice(0, MAX_LAB_NAME_LENGTH),
        name: name.trim().slice(0, MAX_NAME_LENGTH),
        phone: phone.trim(),
        remark: remark.trim().slice(0, MAX_REMARK_LENGTH),
        images: imageFileIds || [],
        user_id: userInfo.userId || '',
        submit_time: new Date().toISOString()
      }
    })
  },

  async removeCloudFiles(fileList) {
    if (!fileList || !fileList.length) return

    try {
      await wx.cloud.deleteFile({ fileList })
    } catch (err) {
      console.error('[duty-upload] 清理云文件失败', err)
    }
  },

  resetForm() {
    this.setData({
      dutyInfo: {
        labName: '',
        name: '',
        phone: '',
        remark: '',
        images: []
      },
      canAddImage: true,
      errors: {}
    })
  }
})
