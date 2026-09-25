import { Event } from '../../types/event';
import { Venue } from '../../types/venue';
import { LiveEventState } from '../../types/liveState';
import { Incident } from '../../types/incident';
import { RecoveryOption } from '../../types/recovery';

export interface PriorityTask {
  id: string;
  eventId: string;
  title: string;
  dueDate: string;
  urgent: boolean;
  completed: boolean;
  description?: string;
}

export interface ActivityItem {
  id: string;
  eventId: string;
  actor: string;
  action: string;
  timestamp: string;
}

export const mockEvents: any[] = [
  {
    id: 'e1',
    name: 'Global Tech Summit 2026',
    status: 'published',
    venue: 'Moscone Center, SF',
    budget: 150000,
    dates: 'Oct 15 - 18, 2026',
    readiness: 84,
    criticalIssues: 0,
    registrationsCurrent: 1248,
    registrationsTarget: 1500,
    budgetUtilized: 63000,
  },
  {
    id: 'e2',
    name: 'Annual Developer Retreat',
    status: 'draft',
    venue: 'Lake Tahoe Resort',
    budget: 45000,
    dates: 'Nov 5 - 7, 2026',
    readiness: 75,
    criticalIssues: 2,
    registrationsCurrent: 210,
    registrationsTarget: 250,
    budgetUtilized: 30000,
  },
  {
    id: 'e3',
    name: 'Q3 Marketing Kickoff',
    status: 'published',
    venue: 'Virtual',
    budget: 15000,
    dates: 'Dec 1 - 2, 2026',
    readiness: 40,
    criticalIssues: 3,
    registrationsCurrent: 150,
    registrationsTarget: 500,
    budgetUtilized: 12000,
  }
];

export const mockTasks: any[] = [
  { id: 't1', eventId: 'e1', title: 'Finalize catering contract', dueDate: 'Today', urgent: true, completed: false, description: 'Review the menu options and finalize headcount.' },
  { id: 't2', eventId: 'e1', title: 'Review AV setup requirements', dueDate: 'Tomorrow', urgent: false, completed: false, description: 'Ensure projectors and microphones are tested.' },
  { id: 't3', eventId: 'e1', title: 'Send out speaker reminders', dueDate: 'In 3 days', urgent: false, completed: false, description: 'Email all keynote speakers with schedule.' },
  { id: 't4', eventId: 'e2', title: 'Confirm hotel block', dueDate: 'Today', urgent: true, completed: false, description: 'Check remaining room availability.' },
  { id: 't5', eventId: 'e2', title: 'Draft schedule', dueDate: 'Next week', urgent: false, completed: false, description: 'Create first draft of daily activities.' },
  { id: 't6', eventId: 'e3', title: 'Test webinar platform', dueDate: 'Today', urgent: true, completed: false, description: 'Run a stress test on the video platform.' },
];

export const mockActivity: any[] = [
  { id: 'a1', eventId: 'e1', actor: 'Sarah Chen', action: 'approved the catering budget', timestamp: '2 hours ago' },
  { id: 'a2', eventId: 'e1', actor: 'Mike Johnson', action: 'uploaded the updated floor plan', timestamp: '5 hours ago' },
  { id: 'a3', eventId: 'e1', actor: 'System', action: 'sent automated speaker reminders', timestamp: '1 day ago' },
  { id: 'a1_2', eventId: 'e1', actor: 'Alice Wang', action: 'confirmed keynote speaker', timestamp: '2 days ago' },
  { id: 'a1_3', eventId: 'e1', actor: 'David Lee', action: 'updated the registration form', timestamp: '2 days ago' },

  { id: 'a4', eventId: 'e2', actor: 'Alex Smith', action: 'created the event draft', timestamp: '2 days ago' },
  { id: 'a2_2', eventId: 'e2', actor: 'System', action: 'flagged hotel block availability', timestamp: '1 day ago' },
  { id: 'a2_3', eventId: 'e2', actor: 'Sarah Chen', action: 'requested budget increase', timestamp: '5 hours ago' },
  { id: 'a2_4', eventId: 'e2', actor: 'Mike Johnson', action: 'added draft schedule', timestamp: '2 hours ago' },

  { id: 'a5', eventId: 'e3', actor: 'Emily Davis', action: 'finalized speaker list', timestamp: '1 hour ago' },
  { id: 'a3_2', eventId: 'e3', actor: 'Alice Wang', action: 'sent marketing emails', timestamp: '3 hours ago' },
  { id: 'a3_3', eventId: 'e3', actor: 'System', action: 'reported low registrations', timestamp: '5 hours ago' },
  { id: 'a3_4', eventId: 'e3', actor: 'David Lee', action: 'changed event to virtual', timestamp: '1 day ago' },
  { id: 'a3_5', eventId: 'e3', actor: 'Sarah Chen', action: 'approved new budget', timestamp: '2 days ago' },
];

export const mockVenues: any[] = [
  {
    id: 'v1',
    name: 'Grand Hyatt Convention Center',
    location: 'San Francisco, CA',
    capacity: 2500,
    pricePerDay: 15000,
    facilities: ['Parking', 'Catering', 'AV', 'WiFi', 'Wheelchair Access'],
    images: [],
    availability: [{ date: '2026-10-15', available: true }],
    rating: 4.8
  },
  {
    id: 'v2',
    name: 'Lake Tahoe Resort',
    location: 'Lake Tahoe, NV',
    capacity: 350,
    pricePerDay: 5000,
    facilities: ['Parking', 'Catering', 'WiFi', 'Outdoor Space'],
    images: [],
    availability: [{ date: '2026-11-05', available: true }],
    rating: 4.5
  },
  {
    id: 'v3',
    name: 'Downtown Tech Hub',
    location: 'Austin, TX',
    capacity: 150,
    pricePerDay: 2000,
    facilities: ['AV', 'WiFi'],
    images: [],
    availability: [{ date: '2026-12-01', available: true }],
    rating: 4.2
  },
  {
    id: 'v4',
    name: 'The Glasshouse',
    location: 'New York, NY',
    capacity: 1000,
    pricePerDay: 12000,
    facilities: ['Catering', 'AV', 'WiFi', 'Outdoor Space', 'Bar'],
    images: [],
    availability: [{ date: '2026-10-15', available: true }],
    rating: 4.9
  },
  {
    id: 'v5',
    name: 'Sunset Beach Club',
    location: 'Miami, FL',
    capacity: 600,
    pricePerDay: 8000,
    facilities: ['Parking', 'Catering', 'Outdoor Space', 'Bar', 'WiFi'],
    images: [],
    availability: [{ date: '2026-11-05', available: true }],
    rating: 4.6
  },
  {
    id: 'v6',
    name: 'Innovation Labs',
    location: 'Seattle, WA',
    capacity: 50,
    pricePerDay: 800,
    facilities: ['AV', 'WiFi', 'Whiteboards'],
    images: [],
    availability: [{ date: '2026-12-01', available: true }],
    rating: 4.0
  },
  {
    id: 'v7',
    name: 'Historic Opera House',
    location: 'Chicago, IL',
    capacity: 1200,
    pricePerDay: 9500,
    facilities: ['Parking', 'AV', 'Wheelchair Access'],
    images: [],
    availability: [{ date: '2026-10-15', available: true }],
    rating: 4.7
  },
  {
    id: 'v8',
    name: 'Mountain View Retreat',
    location: 'Denver, CO',
    capacity: 200,
    pricePerDay: 3000,
    facilities: ['Parking', 'Catering', 'WiFi', 'Outdoor Space'],
    images: [],
    availability: [{ date: '2026-11-05', available: false }], // booked
    rating: 4.4
  },
];

export const mockLiveStates: Record<string, any> = {
  'e1': {
    eventId: 'e1',
    overallHealth: 'ON_TRACK',
    taskStatuses: [
      { id: 't1', name: 'Stage Setup', planned: '10:00 AM', actual: '10:15 AM', status: 'ON_TRACK', variance: '+15m' },
      { id: 't2', name: 'Audio Check', planned: '11:00 AM', actual: 'Pending', status: 'ON_TRACK' }
    ],
    providerStatuses: [
      { id: 'p1', name: 'Catering Team', planned: 'Arrive 09:00 AM', actual: 'Arrived 09:10 AM', status: 'ON_TRACK', variance: '+10m' },
      { id: 'p2', name: 'AV Technicians', planned: 'Arrive 08:30 AM', actual: 'Arrived 08:30 AM', status: 'ON_TRACK' }
    ],
    venueStatus: [
      { id: 'v1', name: 'Main Hall Access', planned: '08:00 AM', actual: '08:00 AM', status: 'ON_TRACK' },
      { id: 'v2', name: 'VIP Lounge Setup', planned: '10:00 AM', actual: '10:45 AM', status: 'AT_RISK', variance: '+45m' }
    ],
    budgetStatus: [
      { id: 'b1', name: 'Contingency Fund', planned: '$10,000', actual: '$8,500', status: 'ON_TRACK' }
    ],
    scheduleStatus: [
      { id: 's1', name: 'Keynote Speaker Arrival', planned: '01:00 PM', actual: 'Pending', status: 'ON_TRACK' }
    ],
    timeline: [
      { id: 'tl1', timestamp: '10:45 AM', event: 'VIP Lounge Setup delayed by 45m', severity: 'AT_RISK' },
      { id: 'tl2', timestamp: '10:15 AM', event: 'Stage Setup completed', severity: 'ON_TRACK' },
      { id: 'tl3', timestamp: '09:10 AM', event: 'Catering Team arrived', severity: 'ON_TRACK' }
    ]
  }
};

export const mockIncidents: any[] = [
  {
    id: 'inc1',
    eventId: 'e1',
    title: 'Caterer Cancelled Last Minute',
    description: 'The primary catering vendor just called and cancelled due to a major kitchen fire. We are currently without food for 150 attendees.',
    severity: 'CRITICAL',
    status: 'OPEN',
    affectedArea: 'Catering',
    detectedAt: '10:05 AM',
    impact: 'Will cause severe guest dissatisfaction and schedule disruption if food is not available by 1:00 PM.',
    riskLevel: 95
  },
  {
    id: 'inc2',
    eventId: 'e1',
    title: 'Venue AV System Failure',
    description: 'Main hall projector is flashing intermittently. Venue technicians are unable to resolve it locally.',
    severity: 'HIGH',
    status: 'OPEN',
    affectedArea: 'AV System',
    detectedAt: '10:25 AM',
    impact: 'Keynote presentation at 1:00 PM will be severely impacted if visuals cannot be displayed.',
    riskLevel: 80
  }
];

export const mockRecoveryOptions: Record<string, any[]> = {
  'inc1': [
    {
      id: 'opt1_1',
      incidentId: 'inc1',
      title: 'Emergency Backup Caterer (Local)',
      description: 'Activate our pre-vetted emergency local caterer. They can deliver a simplified menu (sandwiches, salads) by 12:45 PM.',
      cost: '+$1,500',
      timeToImplement: '2.5 hrs',
      tradeoffs: ['Simplified menu', 'Higher cost premium', 'Guaranteed delivery'],
      recommended: true
    },
    {
      id: 'opt1_2',
      incidentId: 'inc1',
      title: 'Food Truck Fleet',
      description: 'Dispatch 3 local food trucks to the venue parking lot. Attendees receive vouchers.',
      cost: '+$800',
      timeToImplement: '1.5 hrs',
      tradeoffs: ['Requires attendees to go outside', 'Potential lines', 'Fun, casual vibe'],
      recommended: false
    }
  ],
  'inc2': [
    {
      id: 'opt2_1',
      incidentId: 'inc2',
      title: 'Rent Replacement Projector',
      description: 'Send a runner to the local AV rental house to pick up a high-lumen backup projector.',
      cost: '+$400',
      timeToImplement: '1.5 hrs',
      tradeoffs: ['Minor setup disruption', 'Requires runner'],
      recommended: true
    }
  ]
};

