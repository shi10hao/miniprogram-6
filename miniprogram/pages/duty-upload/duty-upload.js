Page({
  data: {
    dutyInfo: {
      labName: '',
      name: '',
      phone: '',
      images: []
    },
    isSubmitting: false
  },

  bindInputLabName(e) {
    this.setData({
      'dutyInfo.labName': e.detail.value
    });
  },

  bindInputName(e) {
    this.setData({
      'dutyInfo.name': e.detail.value
    });
  },

  bindInputPhone(e) {
    this.setData({
      'dutyInfo.phone': e.detail.value
    });
  },

  chooseImage() {
    const remaining = 3 - this.data.dutyInfo.images.length
    if (remaining <= 0) {
      wx.showToast({ title: '最多上传3张照片', icon: 'none' })
      return
    }

    wx.chooseImage({
      count: remaining,
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        this.setData({
          'dutyInfo.images': this.data.dutyInfo.images.concat(res.tempFilePaths)
        });
      }
    });
  },

  deleteImage(e) {
    const index = e.currentTarget.dataset.index;
    const images = this.data.dutyInfo.images;
    images.splice(index, 1);
    this.setData({
      'dutyInfo.images': images
    });
  },

  handleSubmit() {
    if (this.data.isSubmitting) {
      return;
    }

    if (!this.validateForm()) {
      return;
    }

    this.setData({ isSubmitting: true });
    wx.showLoading({ title: '提交中...' });

    this.uploadDutyImages(this.data.dutyInfo.images)
      .then(fileIds => this.saveDutyRecord(fileIds))
      .then(() => {
        wx.hideLoading();
        wx.showToast({ title: '提交成功', icon: 'success' });
        this.resetForm();
        setTimeout(() => {
          if (getCurrentPages().length > 1) {
            wx.navigateBack();
          }
        }, 800);
      })
      .catch(err => {
        wx.hideLoading();
        console.error('提交值日信息失败:', err);
        wx.showToast({ title: '提交失败，请重试', icon: 'none' });
      })
      .finally(() => {
        this.setData({ isSubmitting: false });
      });
  },

  uploadDutyImages(images) {
    const uploadTasks = (images || []).map((filePath, index) => {
      return new Promise((resolve, reject) => {
        wx.cloud.uploadFile({
          cloudPath: `duty_records/duty_${Date.now()}_${index}.jpg`,
          filePath,
          success: res => resolve(res.fileID),
          fail: reject
        });
      });
    });

    return Promise.all(uploadTasks);
  },

  saveDutyRecord(imageFileIds) {
    const db = wx.cloud.database();
    const userInfo = wx.getStorageSync('userInfo') || {};
    const { labName, name, phone } = this.data.dutyInfo;

    return db.collection('duty_records').add({
      data: {
        lab_name: labName.trim(),
        name: name.trim(),
        phone: phone.trim(),
        images: imageFileIds || [],
        user_id: userInfo.userId || '',
        submit_time: new Date().toISOString()
      }
    });
  },

  resetForm() {
    this.setData({
      dutyInfo: {
        labName: '',
        name: '',
        phone: '',
        images: []
      }
    });
  },

  validateForm() {
    const { labName, name, phone } = this.data.dutyInfo;
    if (!labName) {
      wx.showToast({ title: '请填写实验室名称', icon: 'none' });
      return false;
    }
    if (!name) {
      wx.showToast({ title: '请填写姓名', icon: 'none' });
      return false;
    }
    if (!/^1[3-9]\d{9}$/.test(phone)) {
      wx.showToast({ title: '手机号格式错误', icon: 'none' });
      return false;
    }
    return true;
  }
});
