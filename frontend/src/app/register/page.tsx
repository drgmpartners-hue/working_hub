/**
 * 공개 가입은 닫혀 있다 (docs/login_logic D-1).
 * 이 시스템은 내부 전용이며, 계정은 대표가 관리 화면(/admin)에서 매니저로 추가한다.
 * 예전 링크로 들어오면 로그인 화면으로 보낸다.
 */
import { redirect } from 'next/navigation';

export default function RegisterPage() {
  redirect('/login');
}
