/** Membership certificate — proof of standing, issued on request. */

import { buildDocumentId, esc, formatDate, isBn, orDash } from '../format';
import { DEFAULT_ORG, getOrgNameBn, getOrgNameEn, renderShell, renderSignatures } from '../theme';
import type { MembershipCertificateData, OrgSettings } from '../types';

export function generateMembershipCertificateHTML(
  data: MembershipCertificateData,
  locale: string = 'bn',
  org: OrgSettings = DEFAULT_ORG
): string {
  const bn = isBn(locale);
  const title = bn ? 'সদস্যপদ সনদ' : 'MEMBERSHIP CERTIFICATE';
  const orgName = bn ? getOrgNameBn(org) : getOrgNameEn(org);

  const body = `
    <section class="panel" style="margin-top: 22px;">
      <div style="text-align: center; font-size: 13px; color: #55655f; letter-spacing: 0.4px;">
        ${bn ? 'এতদ্বারা প্রত্যয়ন করা যাচ্ছে যে' : 'This is to certify that'}
      </div>
      <div style="text-align: center; font-size: 24px; font-weight: 700; color: #0b544e; margin: 10px 0 4px;">
        ${orDash(data.memberName)}
      </div>
      <div style="text-align: center; font-size: 11px; color: #8a9894;">
        ${bn ? 'সদস্য আইডি' : 'Member ID'}: ${orDash(data.memberId)}
      </div>
      <p style="margin: 18px auto 0; max-width: 150mm; text-align: center; font-size: 12.5px; line-height: 1.95;">
        ${bn
          ? `${esc(orgName)}-এর একজন নিবন্ধিত ও সক্রিয় সদস্য হিসেবে তালিকাভুক্ত আছেন। সদস্য হিসেবে তিনি সংগঠনের সঞ্চয়, সুদমুক্ত ঋণ (কর্জে হাসানাহ্) এবং সদস্যসেবামূলক সকল কার্যক্রমে অংশগ্রহণের অধিকারী।`
          : `is a registered and active member of ${esc(orgName)}, and is entitled to participate in its savings, interest-free lending (Qard al-Hasan), and member welfare activities.`}
      </p>
    </section>

    <section class="panel">
      <div class="panel-title">${bn ? 'সদস্যের বিবরণ' : 'Member details'}</div>
      <div class="kv-grid">
        <div class="kv">
          <span class="kv-label">${bn ? 'হিসাব নং' : 'Account No'}</span>
          <span class="kv-value">${orDash(data.accountNumber)}</span>
        </div>
        <div class="kv">
          <span class="kv-label">${bn ? 'সদস্যপদ শুরু' : 'Member since'}</span>
          <span class="kv-value">${formatDate(data.memberSince, locale)}</span>
        </div>
        <div class="kv">
          <span class="kv-label">${bn ? 'মোবাইল' : 'Mobile'}</span>
          <span class="kv-value">${orDash(data.phone)}</span>
        </div>
        <div class="kv">
          <span class="kv-label">${bn ? 'ইস্যুর তারিখ' : 'Issued on'}</span>
          <span class="kv-value">${formatDate(new Date().toISOString(), locale)}</span>
        </div>
        ${data.address
          ? `<div class="kv wide">
               <span class="kv-label">${bn ? 'ঠিকানা' : 'Address'}</span>
               <span class="kv-value">${orDash(data.address)}</span>
             </div>`
          : ''}
      </div>
    </section>`;

  return renderShell({
    locale,
    org,
    title,
    refLabel: bn ? 'সদস্য আইডি' : 'Member ID',
    refValue: data.memberId || '—',
    documentId: buildDocumentId('CERT', data.memberId),
    windowTitle: `${title} · ${data.memberId}`,
    body,
    showLedgerNotice: false,
    signatures: renderSignatures([
      { role: bn ? 'হিসাব রক্ষক' : 'Accountant' },
      { role: bn ? 'অনুমোদিত স্বাক্ষর' : 'Authorised signature', who: DEFAULT_ORG.nameEn },
    ]),
  });
}
