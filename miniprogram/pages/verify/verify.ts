/**
 * @page U3 身份认证页（三类身份选择与认证提交）
 * @ac F1-AC1（学生认证提交） / F1-AC3（名单外提示"该校暂不支持"+申请加入入口） / F36-AC1（学校列表）
 * @module PIM-BC-01 用户与认证
 * 关键元素：身份选择（学生/教职工/商家）、学号/校园邮箱填写、支持学校列表、名单外"申请加入"入口。
 */
import { submitVerify, VerifySubmitPayload } from '../../services/api/auth';
import { getSchools, joinSchool, SchoolItem } from '../../services/api/school';

type IdentityTab = 'student' | 'staff' | 'merchant';
type StudentVerifyType = 'student_no' | 'campus_email';

Page({
  data: {
    // 身份 Tab（merchant 引导材料上传占位 + U5 入驻申请提示）
    identityTab: 'student' as IdentityTab,
    tabs: [
      { key: 'student', label: '学生' },
      { key: 'staff', label: '教职工' },
      { key: 'merchant', label: '商家' },
    ],
    // 学校列表
    schools: [] as SchoolItem[],
    schoolsLoading: false,
    schoolsError: '',
    schoolKeyword: '',
    selectedSchoolId: 0,
    // 学生表单
    verifyType: 'student_no' as StudentVerifyType,
    realName: '',
    studentNo: '',
    campusEmail: '',
    // 教职工表单（MVP 沿用学生规则，校园邮箱认证）
    staffNo: '',
    staffEmail: '',
    // 商家材料上传占位
    merchantEvidence: [] as string[],
    // 名单外申请加入
    showJoinForm: false,
    joinSchoolName: '',
    joinReason: '',
    joinSubmitting: false,
    submitting: false,
  },

  onLoad() {
    this.loadSchools();
  },

  // ---------- 学校列表（§5.2 #5 GET /schools） ----------
  loadSchools(keyword = '') {
    this.setData({ schoolsLoading: true, schoolsError: '' });
    getSchools({ keyword, page: 1, pageSize: 50 })
      .then((res) => {
        const schools = res.list || [];
        this.setData({
          schools,
          schoolsLoading: false,
          // 名单外（搜索无结果）时展示申请加入入口（F36-AC1）
          showJoinForm: !!keyword && schools.length === 0,
          joinSchoolName: !!keyword && schools.length === 0 ? keyword : this.data.joinSchoolName,
        });
      })
      .catch((err: Error) => {
        this.setData({ schoolsLoading: false, schoolsError: err.message || '学校列表加载失败' });
      });
  },

  onSchoolKeywordInput(e: WechatMiniprogram.Input) {
    const keyword = e.detail.value.trim();
    this.setData({ schoolKeyword: keyword });
    this.loadSchools(keyword);
  },

  onSelectSchool(e: WechatMiniprogram.BaseEvent) {
    const { id } = e.currentTarget.dataset as { id: number };
    this.setData({ selectedSchoolId: id, showJoinForm: false });
  },

  onRetrySchools() {
    this.loadSchools(this.data.schoolKeyword);
  },

  // ---------- 身份 Tab ----------
  onTabChange(e: WechatMiniprogram.BaseEvent) {
    const { key } = e.currentTarget.dataset as { key: IdentityTab };
    this.setData({ identityTab: key });
  },

  onVerifyTypeChange(e: WechatMiniprogram.BaseEvent) {
    const { type } = e.currentTarget.dataset as { type: StudentVerifyType };
    this.setData({ verifyType: type });
  },

  onInput(e: WechatMiniprogram.Input) {
    const { field } = e.currentTarget.dataset as { field: string };
    this.setData({ [field]: e.detail.value });
  },

  // ---------- 商家材料上传占位 ----------
  onChooseEvidence() {
    wx.chooseMedia({
      count: 3,
      mediaType: ['image'],
      success: (res) => {
        const files = res.tempFiles.map((f) => f.tempFilePath);
        this.setData({ merchantEvidence: this.data.merchantEvidence.concat(files).slice(0, 3) });
      },
    });
  },

  onGoMerchantApply() {
    // U5 商家入驻申请页由后续任务提供，先占位提示
    wx.showToast({ title: '商家入驻申请页（U5）待接入', icon: 'none' });
  },

  // ---------- 名单外申请加入（§5.2 #6 POST /schools/join，F36-AC1） ----------
  onJoinInput(e: WechatMiniprogram.Input) {
    const { field } = e.currentTarget.dataset as { field: string };
    this.setData({ [field]: e.detail.value });
  },

  onSubmitJoin() {
    if (!this.data.joinSchoolName.trim()) {
      wx.showToast({ title: '请填写学校名称', icon: 'none' });
      return;
    }
    if (this.data.joinSubmitting) return;
    this.setData({ joinSubmitting: true });
    joinSchool({ school_id: 0, evidence: [this.data.joinSchoolName.trim(), this.data.joinReason.trim()] })
      .then(() => {
        wx.showToast({ title: '申请已提交，请等待开通', icon: 'success' });
        this.setData({ showJoinForm: false });
      })
      .catch((err: Error) => {
        wx.showToast({ title: err.message || '申请提交失败', icon: 'none' });
      })
      .finally(() => this.setData({ joinSubmitting: false }));
  },

  // ---------- 认证提交（§5.2 #3 POST /auth/verify，F1-AC1） ----------
  onSubmit() {
    const d = this.data;
    if (d.identityTab === 'merchant') {
      this.onGoMerchantApply();
      return;
    }
    if (!d.selectedSchoolId) {
      wx.showToast({ title: '请选择学校', icon: 'none' });
      return;
    }
    if (!d.realName.trim()) {
      wx.showToast({ title: '请填写真实姓名', icon: 'none' });
      return;
    }
    const schoolId = String(d.selectedSchoolId);
    const realName = d.realName.trim();
    let payload: VerifySubmitPayload;
    if (d.identityTab === 'student') {
      if (d.verifyType === 'student_no') {
        if (!d.studentNo.trim()) {
          wx.showToast({ title: '请填写学号', icon: 'none' });
          return;
        }
        payload = { school_id: schoolId, verify_type: 'student_no', student_no: d.studentNo.trim(), real_name: realName, staff_flag: false };
      } else {
        if (!/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(d.campusEmail.trim())) {
          wx.showToast({ title: '请填写正确的校园邮箱', icon: 'none' });
          return;
        }
        payload = { school_id: schoolId, verify_type: 'campus_email', campus_email: d.campusEmail.trim(), real_name: realName, staff_flag: false };
      }
    } else {
      // 教职工：工号走 student_no 通道 + staff_flag=true（MVP 沿用学生规则，校园邮箱仅前端留存校验）
      if (!d.staffNo.trim()) {
        wx.showToast({ title: '请填写工号', icon: 'none' });
        return;
      }
      if (!/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(d.staffEmail.trim())) {
        wx.showToast({ title: '请填写正确的校园邮箱', icon: 'none' });
        return;
      }
      payload = { school_id: schoolId, verify_type: 'student_no', student_no: d.staffNo.trim(), real_name: realName, staff_flag: true };
    }

    if (d.submitting) return;
    this.setData({ submitting: true });
    submitVerify(payload)
      .then((res) => {
        wx.redirectTo({ url: `/pages/verify-result/verify-result?status=${res.status}` });
      })
      .catch((err: Error & { code?: number }) => {
        // F1-AC3：1006 学校未开放 → 提示"该校暂不支持"并展示申请加入入口
        if (err.code === 1006) {
          wx.showToast({ title: '该校暂不支持', icon: 'none' });
          this.setData({ showJoinForm: true });
        } else {
          wx.showToast({ title: err.message || '提交失败，请重试', icon: 'none' });
        }
      })
      .finally(() => this.setData({ submitting: false }));
  },
});
