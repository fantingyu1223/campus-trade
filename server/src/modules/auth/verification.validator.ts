/**
 * @model PIM-AG-01
 * @rule CIM-R-02
 * 身份认证入参校验器（学号 / 校园邮箱两通道，教职工沿用学生规则）。
 * 注意：import BusinessError 自 auth.service 属循环引用，仅类型/调用时访问，安全。
 */
import { VerifyType } from '@contract/enums';
import { ERROR_CODES } from '@contract/error-codes';
import { BusinessError } from './auth.service';
import { VerifySubmitRequest } from './dto/verify.dto';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function fail(message: string): never {
  throw new BusinessError(ERROR_CODES.PARAM_VALIDATION_FAILED, message);
}

export function validateVerifySubmitDto(input: unknown): VerifySubmitRequest {
  const body = (input ?? {}) as Record<string, unknown>;

  const schoolId = body.school_id;
  if (typeof schoolId !== 'string' || !/^\d+$/.test(schoolId.trim())) {
    fail('school_id 缺失或非法');
  }

  const verifyType = body.verify_type;
  if (verifyType !== VerifyType.STUDENT_NO && verifyType !== VerifyType.CAMPUS_EMAIL) {
    fail('verify_type 缺失或非法（仅支持 student_no / campus_email）');
  }

  let studentNo: string | undefined;
  let campusEmail: string | undefined;
  if (verifyType === VerifyType.STUDENT_NO) {
    if (typeof body.student_no !== 'string' || body.student_no.trim().length === 0) {
      fail('student_no 缺失（学号通道必填）');
    }
    studentNo = body.student_no.trim();
    if (studentNo.length > 64) fail('student_no 超长');
  } else {
    if (typeof body.campus_email !== 'string' || !EMAIL_RE.test(body.campus_email.trim())) {
      fail('campus_email 缺失或格式非法（校园邮箱通道必填）');
    }
    campusEmail = body.campus_email.trim().toLowerCase();
    if (campusEmail.length > 128) fail('campus_email 超长');
  }

  let staffFlag = false;
  if (body.staff_flag !== undefined) {
    if (typeof body.staff_flag !== 'boolean') fail('staff_flag 须为布尔值');
    staffFlag = body.staff_flag;
  }

  let realName: string | undefined;
  if (body.real_name !== undefined) {
    if (typeof body.real_name !== 'string' || body.real_name.trim().length === 0) {
      fail('real_name 非法');
    }
    realName = body.real_name.trim();
    if (realName.length > 64) fail('real_name 超长');
  }

  let major: string | undefined;
  if (body.major !== undefined) {
    if (typeof body.major !== 'string') fail('major 非法');
    major = body.major.trim();
    if (major.length > 128) fail('major 超长');
  }

  let enrollmentYear: number | undefined;
  if (body.enrollment_year !== undefined) {
    const y = body.enrollment_year;
    if (typeof y !== 'number' || !Number.isInteger(y) || y < 1900 || y > 2100) {
      fail('enrollment_year 非法');
    }
    enrollmentYear = y;
  }

  return {
    school_id: schoolId.trim(),
    verify_type: verifyType,
    student_no: studentNo,
    campus_email: campusEmail,
    real_name: realName,
    staff_flag: staffFlag,
    major,
    enrollment_year: enrollmentYear,
  };
}
