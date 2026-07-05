/** Small, dependency-free word banks for the built-in generators. */

export const FIRST_NAMES = [
  'James', 'Mary', 'John', 'Patricia', 'Robert', 'Jennifer', 'Michael', 'Linda',
  'William', 'Elizabeth', 'David', 'Barbara', 'Richard', 'Susan', 'Joseph', 'Jessica',
  'Thomas', 'Sarah', 'Charles', 'Karen',
] as const;

export const LAST_NAMES = [
  'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis',
  'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez', 'Wilson', 'Anderson', 'Thomas',
  'Taylor', 'Moore', 'Jackson', 'Martin',
] as const;

export const NICKNAME_ADJECTIVES = [
  'Swift', 'Silent', 'Brave', 'Clever', 'Lucky', 'Wild', 'Quiet', 'Bold',
  'Sharp', 'Bright', 'Dark', 'Iron', 'Golden', 'Silver', 'Crimson', 'Shadow',
] as const;

export const NICKNAME_NOUNS = [
  'Fox', 'Wolf', 'Hawk', 'Tiger', 'Falcon', 'Raven', 'Panther', 'Eagle',
  'Cobra', 'Lynx', 'Otter', 'Bear', 'Owl', 'Viper', 'Phoenix', 'Dragon',
] as const;

export const LOREM_WORDS = [
  'lorem', 'ipsum', 'dolor', 'sit', 'amet', 'consectetur', 'adipiscing', 'elit',
  'sed', 'do', 'eiusmod', 'tempor', 'incididunt', 'ut', 'labore', 'et',
  'dolore', 'magna', 'aliqua', 'enim', 'ad', 'minim', 'veniam', 'quis',
  'nostrud', 'exercitation', 'ullamco', 'laboris', 'nisi', 'aliquip', 'ex', 'ea',
  'commodo', 'consequat', 'duis', 'aute', 'irure', 'in', 'reprehenderit', 'voluptate',
] as const;

export const EMAIL_DOMAINS = ['example.com', 'mail.com', 'test.org'] as const;
