/** Membership certificate — proof of standing, issued on request. */

import { buildDocumentId, documentFilename, formatDate, orDash } from '../format';
import { DEFAULT_ORG, getOrgNameEn } from '../theme';
import type { Block, DocumentModel, Field, MembershipCertificateData, OrgSettings } from '../types';

export function buildMembershipCertificate(
  data: MembershipCertificateData,
  org: OrgSettings = DEFAULT_ORG
): DocumentModel {
  const orgName = getOrgNameEn(org);

  const details: Field[] = [
    { label: 'Member since', value: formatDate(data.memberSince) },
    { label: 'Mobile', value: orDash(data.phone) },
    { label: 'Issued on', value: formatDate(new Date().toISOString()) },
  ];
  if (data.address?.trim()) {
    details.push({ label: 'Address', value: data.address.trim(), wide: true });
  }

  const blocks: Block[] = [
    {
      kind: 'certify',
      intro: 'This is to certify that',
      name: orDash(data.memberName),
      subtitle: `Account No: ${orDash(data.accountNo)}`,
      body:
        `is a registered and active member of ${orgName}, and is entitled to participate ` +
        'in its savings, interest-free lending (Qard al-Hasan), and member welfare activities.',
    },
    { kind: 'fields', title: 'Member details', fields: details },
    {
      kind: 'signatures',
      signatures: [
        { role: 'Accountant' },
        { role: 'Authorised signature', who: DEFAULT_ORG.nameEn },
      ],
    },
  ];

  return {
    title: 'Membership Certificate',
    refLabel: 'Account No',
    refValue: orDash(data.accountNo),
    documentId: buildDocumentId('CERT', data.accountNo),
    filename: documentFilename('Membership-Certificate', data.accountNo),
    org,
    blocks,
  };
}
